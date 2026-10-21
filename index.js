// qq-agent-mood —— 给 AI 角色一颗会变的心。
//
// 只用插件 API 里有的东西：registerTool / config / log / hooks / providers。
// 不碰应用源码、不开路由、不加页面（面板是插件自己起的小服务）。
// 数据：<数据目录>/self/qq-agent-mood/mood.json，卸载即消失。
import fs from 'node:fs';
import path from 'node:path';
import { dataRoot, mergeConfig, readState, writeState, clearState } from './lib/store.js';
import { applyKind } from './lib/apply.js';
import { ruleKind, normalizeKind } from './lib/rule.js';
import { judgeKind } from './lib/judge.js';
import { buildMoodLine } from './lib/prompt.js';
import { bandOf, clampScore, decayScore } from './lib/score.js';

// 设置项是扁平的（应用的设置表单只认 boolean/number/enum/string），
// 这里拼成内部用的 {bands,weights,mute,caps}，免得两套写法打架。
export const DEFAULTS = {
  enabled: true,
  characterName: '她',
  ownerIds: '',
  temper: 1,
  calmHours: 6,
  lowMood: '只是语气变',
  useJudge: true,
  judgeMaxPerDay: 300,
  judgeTimeoutMs: 8000,
  judgeModel: '',
  judgeApiBase: '',
  judgeApiKey: '',
  decayStrength: '中',
  bandIgnore: -60,
  bandHurt: -20,
  bandHappy: 20,
  bandGlad: 60,
  weightInsult: -40,
  weightDismissive: -10,
  weightAmused: -12,
  weightPraise: 12,
  weightSootheOwner: 35,
  weightSootheOther: 8,
  muteIgnore: 0.75,
  muteHurt: 0.5,
  capLow: 2,
  panel: true,
  panelPort: 3221,
  alwaysShow: false,
};

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

let api = null;
let panelHandle = null;
let ownerCache = { at: 0, ids: null };
let lastBand = 'calm';   // providers 是同步的，只能读这个缓存

function log(...args) { try { api?.log?.(...args); } catch { /* 日志失败不影响功能 */ } }

function cfgNow() {
  const saved = (() => { try { return api?.config?.() || {}; } catch { return {}; } })();
  const merged = mergeConfig(DEFAULTS, saved);
  const t = Number(merged.temper);
  const scale = Number.isFinite(t) && t > 0 ? Math.min(2, Math.max(0.5, t)) : 1;
  merged.temperScale = scale;
  // 「多久消气」小时数 → 每小时回落分数（6 小时 = 每小时约 17 分）
  const h = Number(merged.calmHours);
  merged.decayPerHour = Number.isFinite(h) && h > 0 ? 100 / h : 6;
  merged.bands = {
    ignore: num(merged.bandIgnore, -60),
    hurt: num(merged.bandHurt, -20),
    happy: num(merged.bandHappy, 20),
    glad: num(merged.bandGlad, 60),
  };
  // 脾气只乘权重、不乘分数：性格一致，情绪快慢靠「多久消气」
  merged.weights = {
    insult: num(merged.weightInsult, -40) * scale,
    dismissive: num(merged.weightDismissive, -10) * scale,
    amused: num(merged.weightAmused, -12) * scale,
    praise: num(merged.weightPraise, 12) * scale,
    sootheOwner: num(merged.weightSootheOwner, 35) * scale,
    sootheOther: num(merged.weightSootheOther, 8) * scale,
  };
  merged.mute = { ignore: num(merged.muteIgnore, 0.75), hurt: num(merged.muteHurt, 0.5) };
  merged.caps = { low: Math.max(1, num(merged.capLow, 2)) };
  return merged;
}

async function ownerIds(cfg) {
  if (ownerCache.ids && Date.now() - ownerCache.at < 60000) return ownerCache.ids;
  let ids = [];
  try {
    const mod = await import('../../src/friend-requests.js');
    if (Array.isArray(mod?.ownerIds)) ids = mod.ownerIds().map(String);
  } catch { /* 版本差异，用设置里的 */ }
  if (!ids.length && cfg.ownerIds) {
    ids = String(cfg.ownerIds).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  ownerCache = { at: Date.now(), ids };
  return ids;
}

async function isOwner(cfg, chatKey, senderId) {
  const ids = await ownerIds(cfg);
  if (senderId && ids.includes(String(senderId))) return true;
  // 没配置白名单时：私聊里跟她说话的就是主人
  return !ids.length && String(chatKey || '').startsWith('private:');
}

function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function takeJudgeSlot(cfg) {
  const max = Number(cfg.judgeMaxPerDay ?? 300);
  if (!Number.isFinite(max) || max <= 0) return false;
  const st = await readState();
  const today = todayKey();
  const used = st.judgeDate === today ? Number(st.judgeUsed) || 0 : 0;
  if (used >= max) return false;
  await writeState({ ...st, judgeDate: today, judgeUsed: used + 1 });
  return true;
}

async function classify(text, cfg) {
  if (cfg.useJudge !== false && await takeJudgeSlot(cfg)) {
    const judged = await judgeKind(text, cfg, log);
    if (judged) return { kind: judged, by: 'judge' };
  }
  return { kind: ruleKind(text), by: 'rule' };
}

// 应用里插件自己的 console.log 不进应用日志，排查只能靠文件留痕。
async function trace(msg) {
  try {
    const dir = await dataRoot();
    fs.appendFileSync(path.join(dir, 'hook.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch { /* 留痕失败不影响主流程 */ }
}

async function appendTail(messages, text) {
  if (!Array.isArray(messages) || !text) return;
  try {
    const p = await import('../../src/prompt.js');
    if (typeof p.appendDynamicTail === 'function') { p.appendDynamicTail(messages, text); return; }
  } catch { /* 老版本没有 */ }
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
  if (!lastUser) return;
  if (typeof lastUser.content === 'string') lastUser.content += `\n\n${text}`;
  else if (Array.isArray(lastUser.content)) lastUser.content.push({ type: 'text', text });
}

// ─────────────────────────── 钩子 ───────────────────────────
export const hooks = {
  /** 每来一句话：判一次、记一笔。 */
  'before-context': async (ctx = {}) => {
    const cfg = cfgNow();
    if (cfg.enabled === false) return;
    // 应用传进来的原文在 triggerEntries 里（ctx.text 不存在），之前只读 ctx.text
    // 导致这个钩子每句都空转、真实聊天一次都没记过分。
    const entries = Array.isArray(ctx.triggerEntries) ? ctx.triggerEntries : [];
    const text = (entries.map((e) => String(e?.text || '')).filter(Boolean).join('\n') || String(ctx.text || '')).trim();
    if (!text) return;
    await trace(`before-context 进来：${text.slice(0, 40).replace(/\s+/g, ' ')}`);

    const senderId = ctx.triggerEntries?.[0]?.senderId ?? ctx.senderId ?? '';
    const name = ctx.triggerEntries?.[0]?.senderName ?? ctx.name ?? '';
    const { kind, by } = await classify(text, cfg);
    const now = Date.now();
    const st = await readState();

    if (kind === 'neutral') {
      const score = decayScore(Number(st.score) || 0, st.since ?? st.at, now, cfg.decayPerHour);
      lastBand = bandOf(score, cfg.bands);
      await writeState({ ...st, score, since: now, at: now });
      return;
    }

    const owner = await isOwner(cfg, ctx.chatKey, senderId);
    const res = applyKind(kind, {
      state: st,
      cfg,
      isOwner: owner,
      why: text.slice(0, 60),
      from: name,
      now,
    });
    lastBand = res.band;
    await writeState({ ...res.state, lastKind: kind, lastBy: by });
    log('情绪 %s %s 分（%s）', kind, res.delta >= 0 ? `+${res.delta}` : res.delta, by);
  },

  /** 每轮发给模型前：贴一行现在的心情。 */
  'before-llm-messages': async (ctx = {}) => {
    try {
      const cfg = cfgNow();
      const st = await readState();
      const score = decayScore(Number(st.score) || 0, st.since ?? st.at, Date.now(), cfg.decayPerHour);
      lastBand = bandOf(score, cfg.bands);
      const line = cfg.enabled === false ? '' : buildMoodLine({ ...st, score }, cfg);
      await trace(`before-llm-messages：分数 ${Math.round(score)} 档位 ${lastBand} ${line ? '要贴' : '不贴'} 消息 ${Array.isArray(ctx.messages) ? ctx.messages.length : '?'} 条`);
      if (line) {
        await appendTail(ctx.messages, line);
        const last = [...(ctx.messages || [])].reverse().find((m) => m?.role === 'user');
        const has = JSON.stringify(last || {}).includes('你现在的情绪');
        await trace(`贴完：最后一条 user ${has ? '已含情绪行' : '没找到情绪行'}`);
      }
      log('心情钩子：分数 %s 档位 %s %s（消息 %s 条）', Math.round(score), lastBand, line ? '贴上了' : '没贴', Array.isArray(ctx.messages) ? ctx.messages.length : '?');
    } catch (error) {
      log('心情钩子出错：%s', error?.message ?? error);
    }
  },
};

// ─────────────────────────── 能力门（补丁装了才有调用方） ───────────────────────────
export const providers = {
  'mood.bubble-cap': () => {
    const cfg = cfgNow();
    if (lastBand === 'ignore') return Math.max(1, Number(cfg.caps?.low ?? 1));
    if (lastBand === 'hurt') return Math.max(1, Number(cfg.caps?.low ?? 2));
    return null;
  },
  'mood.mute-rate': () => {
    const cfg = cfgNow();
    if (lastBand === 'ignore') return Number(cfg.mute?.ignore ?? 0.75);
    if (lastBand === 'hurt') return Number(cfg.mute?.hurt ?? 0.5);
    return 0;
  },
};

// ─────────────────────────── 装配 ───────────────────────────
export function setup(a) {
  api = a;
  lastBand = 'calm';

  a.registerTool({
    id: 'note_mood',
    name: '记一下心情',
    description: '这句话该记在她心上时调一次：被骂、逗嘴、被敷衍、被夸、被哄。调用会真的改变她的心情，一句话最多一次。',
    category: 'utility',
    icon: '💗',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['insult', 'tease', 'dull', 'praise', 'soothe', 'neutral'],
          description: 'insult 被骂 / tease 逗嘴 / dull 被敷衍 / praise 被夸 / soothe 被哄 / neutral 不记',
        },
        why: { type: 'string', description: '一句话理由，面板上会显示（别写对方原话）' },
      },
      required: ['kind'],
    },
    async execute(ctx, args) {
      const cfg = cfgNow();
      const st = await readState();
      // 2 分钟内判官刚预判过：从预判前的分数起算，避免同一句记两遍
      const base = (st.provAt && Date.now() - st.provAt <= 120000 && Number.isFinite(st.provScore))
        ? st.provScore
        : st.score;
      const kind = normalizeKind(args?.kind);
      if (kind === 'neutral') return { ok: true, text: '这句不记。' };
      const res = applyKind(kind, {
        state: { ...st, score: base },
        cfg,
        isOwner: await isOwner(cfg, ctx?.chatKey, ctx?.senderId),
        why: String(args?.why || '').slice(0, 60),
        from: '',
        deterministic: true,
      });
      lastBand = res.band;
      await writeState({ ...res.state, lastKind: kind, lastBy: 'self' });
      return {
        ok: true,
        text: res.delta === 0 ? '记下了，分数没怎么动。' : `记下了（${res.delta > 0 ? '+' : ''}${res.delta}）。`,
        score: res.score,
        band: res.band,
      };
    },
  });

  if (cfgNow().panel !== false) startPanelSafe();
}

async function startPanelSafe() {
  if (panelHandle) return;
  try {
    const { startPanel } = await import('./panel/server.mjs');
    panelHandle = await startPanel({
      cfg: cfgNow,
      log,
      read: readState,
      write: writeState,
      clear: clearState,
      apply: applyKind,
      bandOf,
      clampScore,
      setCache: (b) => { lastBand = b; },
    });
    log('面板已启动：http://127.0.0.1:%s', panelHandle.port);
  } catch (error) {
    log('面板没起来：%s', error?.message ?? error);
  }
}

export function activate() { /* setup 会重跑 */ }
export function available() { return true; }
export function dispose() {
  try { panelHandle?.close?.(); } catch { /* 正在关 */ }
  panelHandle = null;
}
