// 判官：把一句话分成六类里的一类。
// 硬要求（都是踩过的坑）：
//   · 超时/失败/超额度 → 一律返回 null，让调用方退回关键词，绝不卡住她的回复
//   · 不传 overrides 给核心的 chatCompletion（它会整体顶掉 api 配置 → Invalid URL）
//   · 有的小模型会"回人话"，所以 system 里明写"你不是聊天对象"，解析还能接受裸词
import { normalizeKind } from './rule.js';

export const JUDGE_SYSTEM = [
  '你不是聊天对象。不要回答那句话本身，不要安慰人、不要表态、不要解释。',
  '你的唯一任务是把它归类，只输出一个 JSON，形如 {"kind":"insult"}。',
  'kind 只能是：insult（骂她/贬低她）tease（逗她、开玩笑式地损）dull（敷衍地打发）praise（夸她/说喜欢她）soothe（真心哄她、站她这边）neutral（其余）。',
].join('\n');

const KIND_HINT = '这句话是别人对她说的一句话，判断它属于哪一类。';

let apiCache = { at: 0, api: null };

/**
 * 找一套能用的接口配置。
 * ① 应用自己的（key 在钥匙串里也能拿到，只要在应用进程内）
 * ② 插件设置里自己填的（别的版本/独立跑的时候兜底）
 * ③ 都没有 → null → 关键词模式
 */
export async function resolveJudgeApi(cfg = {}) {
  if (apiCache.api && Date.now() - apiCache.at < 60000) return apiCache.api;

  let api = null;
  try {
    const [{ getConfig }, { resolveApiKey }] = await Promise.all([
      import('../../src/config.js'),
      import('../../src/llm.js'),
    ]);
    const c = getConfig();
    const key = String(resolveApiKey(c) || '').trim();
    if (key) {
      api = {
        baseUrl: String(c?.api?.baseUrl || '').replace(/\/+$/, ''),
        model: String(cfg.judgeModel || c?.api?.model || '').trim(),
        key,
      };
    }
  } catch { /* 版本差异，往下退 */ }

  if (!api && cfg.judgeApiKey && cfg.judgeApiBase) {
    api = {
      baseUrl: String(cfg.judgeApiBase).replace(/\/+$/, ''),
      model: String(cfg.judgeModel || '').trim(),
      key: String(cfg.judgeApiKey).trim(),
    };
  }

  apiCache = { at: Date.now(), api };
  return api;
}

function pickJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch { /* 往下走裸词 */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* 放弃 JSON */ } }
  return null;
}

/**
 * 判一次。
 * @returns {Promise<'insult'|'tease'|'dull'|'praise'|'soothe'|'neutral'|null>} null = 没判成
 */
export async function judgeKind(text, cfg = {}, log = () => {}) {
  const api = await resolveJudgeApi(cfg);
  if (!api?.baseUrl || !api?.model) return null;

  const timeoutMs = Math.max(1000, Number(cfg.judgeTimeoutMs) || 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${api.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.key}` },
      body: JSON.stringify({
        model: api.model,
        temperature: 0,
        max_tokens: 24,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: `${KIND_HINT}\n「${String(text || '').slice(0, 200)}」` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) { log('judge http %s', res.status); return null; }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const obj = pickJson(content);
    const kind = normalizeKind(obj?.kind ?? content);
    log('judge ok kind=%s', kind);
    return kind;
  } catch (error) {
    log('judge fail %s', error?.name === 'AbortError' ? 'timeout' : error?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
