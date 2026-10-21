// 可选补丁：把「心情低就少说话/不发」接进应用。
//
// 为什么需要补丁：插件没有路由、不能改核心（插件 API 只有 tools/hooks/providers）。
// 心情本身、面板、记分都不需要补丁 —— 只有「真的压气泡、真的静音」这两件必须在
// 发消息/决定要不要回那一刻拦住，所以只能改两行核心代码。
//
// 安全措施：
//   1. 只认「锚点原文」，锚点必须**恰好出现一次**；对不上就一个字都不改。
//   2. 改之前先备份（<文件>.bak-before-qq-agent-mood），再原子写。
//   3. 记下改前/改后的 sha256，uninstall 靠它判断能不能安全还原。
//   4. 默认不跑：必须有人显式执行本文件。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ORCH = {
  label: 'src/orchestrator.js',
  marker: "this.#capFirst('mood.mute-rate'",
  ways: [
    path.join(HERE, '..', '..', '..', 'src', 'orchestrator.js'),
    path.join(HERE, '..', '..', 'src', 'orchestrator.js'),
  ],
  edits: [
    {
      // 顺手去掉对 mood.js 的依赖：补丁之后这两行不该再 import 核心的心情模块
      from: "import { readMoodReaction, moodMuteRate } from './mood.js';\n",
      to: '',
    },
    {
      from: '        const moodReaction = readMoodReaction();\n        const muteRate = moodMuteRate(moodReaction, cfg);\n',
      to: [
        '        // 心情插件（可选补丁）：没装插件时 muteRate 恒为 0，行为跟没打补丁完全一样。',
        '        let muteRate = 0;',
        '        try {',
        "          const moodMuteOf = this.#capFirst('mood.mute-rate', { chatKey });",
        '          if (moodMuteOf) muteRate = Number(await moodMuteOf({ chatKey })) || 0;',
        '        } catch { muteRate = 0; }',
        '',
      ].join('\n'),
    },
  ],
};

const TOOLS = {
  label: 'src/tools.js',
  marker: "getCapabilityProviders('mood.bubble-cap'",
  ways: [
    path.join(HERE, '..', '..', '..', 'src', 'tools.js'),
    path.join(HERE, '..', '..', 'src', 'tools.js'),
  ],
  edits: [
    {
      from: "import { readMoodReaction, moodBubbleCap } from './mood.js';\n",
      to: '',
    },
    {
      from: '  const moodCap = moodBubbleCap(readMoodReaction(), { isPrivate });\n  const capByMood = moodCap === null ? base : moodCap;\n',
      to: [
        '  // 心情插件（可选补丁）：没有提供者时 moodCap 为 null，跟没打补丁完全一样。',
        '  let moodCap = null;',
        '  try {',
        "    const fn = skillManager.getCapabilityProviders('mood.bubble-cap', { isPrivate })[0]?.fn;",
        '    if (typeof fn === \'function\') {',
        '      const v = fn({ isPrivate });',
        '      if (Number.isFinite(Number(v))) moodCap = Number(v);',
        '    }',
        '  } catch { moodCap = null; }',
        '  const capByMood = moodCap === null ? base : Math.min(base, moodCap);',
        '',
      ].join('\n'),
    },
  ],
};

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n');
const count = (s, sub) => (sub ? (s.match(new RegExp(escapeRe(sub), 'g')) || []).length : 0);
const findFile = (w) => w.ways.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;

function applyOne(target) {
  const file = findFile(target);
  if (!file) return { ok: false, why: `找不到 ${target.label}（应用装在别处？把补丁目录放进 resources/app/plugins/ 再跑）` };
  const before = fs.readFileSync(file);
  const text = before.toString('utf8');

  // 已经打过？（认补丁自己写进去的那一行，不认注释）
  if (target.marker && text.includes(target.marker)) {
    return { ok: true, already: true, file, label: target.label, why: '已经是打过补丁的样子，跳过。' };
  }

  // 换行可能被仓库/编辑器改成 CRLF，所以锚点按「\r?\n」来认；替换时跟着原文件的换行走
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let next = text;
  for (const e of target.edits) {
    const n = count(next, e.from);
    if (n !== 1) return { ok: false, why: `锚点在 ${target.label} 里出现 ${n} 次（应为 1 次），不敢动。` };
    const to = e.to.split('\n').join(eol);
    next = next.replace(new RegExp(escapeRe(e.from)), () => to);
  }
  if (next === text) return { ok: false, why: `${target.label} 没有变化，锚点可能已过期。` };

  const backup = `${file}.bak-before-qq-agent-mood`;
  fs.copyFileSync(file, backup);
  const tmp = `${file}.tmp-qqmood`;
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, file);

  return { ok: true, file, backup, before: sha(before), after: sha(Buffer.from(next, 'utf8')), label: target.label };
}

export function install() {
  return [applyOne(ORCH), applyOne(TOOLS)];
}

/** 还原：直接用打补丁前的备份盖回去（比反推替换可靠）。 */
export function uninstall() {
  const out = [];
  for (const target of [ORCH, TOOLS]) {
    const file = findFile(target);
    if (!file) { out.push({ ok: false, label: target.label, why: `找不到 ${target.label}` }); continue; }
    const backup = `${file}.bak-before-qq-agent-mood`;
    if (!fs.existsSync(backup)) {
      out.push({ ok: false, file, label: target.label, why: '没有备份——可能没打过补丁，或者备份被删了。为了安全，不动。' });
      continue;
    }
    const cur = fs.readFileSync(file).toString('utf8');
    if (target.marker && !cur.includes(target.marker)) {
      out.push({ ok: false, file, label: target.label, why: '当前文件里没有补丁痕迹（可能已还原过，或被人手改过），不动。' });
      continue;
    }
    // 把打补丁后的样子留一份，万一想再打回去
    const patched = `${file}.patched-${Date.now()}`;
    fs.copyFileSync(file, patched);
    const tmp = `${file}.tmp-qqmood`;
    fs.copyFileSync(backup, tmp);
    fs.renameSync(tmp, file);
    out.push({ ok: true, file, label: target.label, patchedCopy: patched });
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const undo = process.argv.includes('--undo');
  // eslint-disable-next-line no-console
  console.log(undo ? '正在还原补丁…' : '正在打补丁（会先备份，改完请重启应用）…');
  const res = (undo ? uninstall() : install());
  for (const r of res) console.log(r.ok ? `  ✓ ${r.file || r.label}${r.already ? '（已打过）' : ''}` : `  ✗ ${r.file || ''} ${r.why}`);
  const failed = res.filter((r) => !r.ok && !r.already);
  if (failed.length) console.log('\n有没成功的，文件没动。');
  else console.log('\n完成。**重启 QQ Agent 生效**（关掉再开，或跑你平时那种重启）。');
  process.exit(failed.length ? 1 : 0);
}
