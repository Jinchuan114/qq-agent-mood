// 测补丁脚本：在临时目录里搭一个「假的应用目录」，把插件和两个核心文件拷进去，
// 打补丁 / 再打一次 / 还原，全程不碰真实的应用文件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
// 要拿真实应用文件来试——路径由跑测试的人给（不写死在仓库里）
const REAL_SRC = process.env.QQ_AGENT_SRC;
if (!REAL_SRC || !fs.existsSync(path.join(REAL_SRC, 'orchestrator.js'))) {
  console.log('跳过：这个测试需要真实的应用源码。先设 QQ_AGENT_SRC=<...>/resources/app/src 再跑。');
  process.exit(0);
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name} ${extra}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qqmoodpatch-'));
const app = path.join(TMP, 'app');
const src = path.join(app, 'src');
const plug = path.join(app, 'plugins', 'qq-agent-mood');
fs.mkdirSync(src, { recursive: true });
fs.cpSync(REPO, plug, {
  recursive: true,
  filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p),
});
for (const f of ['orchestrator.js', 'tools.js']) {
  fs.copyFileSync(path.join(REAL_SRC, f), path.join(src, f));
}
const orig = Object.fromEntries(['orchestrator.js', 'tools.js'].map((f) => [f, sha(path.join(src, f))]));

const run = (arg) => {
  const args = [path.join(plug, 'patch', 'install.mjs')];
  if (arg) args.push(arg);
  try {
    return { out: execFileSync(process.execPath, args, { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status ?? 1 };
  }
};

console.log('· 打补丁');
const r1 = run();
ok('脚本成功退出', r1.code === 0, r1.out);
const orch = fs.readFileSync(path.join(src, 'orchestrator.js'), 'utf8');
const tools = fs.readFileSync(path.join(src, 'tools.js'), 'utf8');
ok('orchestrator 走了能力门', orch.includes("this.#capFirst('mood.mute-rate'") && !orch.includes('moodMuteRate(moodReaction, cfg)'));
ok('orchestrator 不再 import mood.js', !orch.includes("from './mood.js'"));
ok('tools 走了能力门', tools.includes("getCapabilityProviders('mood.bubble-cap'") && !tools.includes('moodBubbleCap(readMoodReaction()'));
ok('tools 不再 import mood.js', !tools.includes("from './mood.js'"));
ok('两个文件都留了备份', fs.existsSync(path.join(src, 'orchestrator.js.bak-before-qq-agent-mood')) && fs.existsSync(path.join(src, 'tools.js.bak-before-qq-agent-mood')));
for (const f of ['orchestrator.js', 'tools.js']) {
  const res = (() => { try { execFileSync(process.execPath, ['--check', path.join(src, f)], { encoding: 'utf8' }); return 0; } catch { return 1; } })();
  ok(`${f} 语法检查通过`, res === 0);
}

console.log('· 再打一次');
const r2 = run();
ok('第二次幂等（说已打过）', r2.code === 0 && /已打过/.test(r2.out), r2.out);

console.log('· 还原');
const r3 = run('--undo');
ok('还原成功退出', r3.code === 0, r3.out);
ok('orchestrator 逐字节回到原样', sha(path.join(src, 'orchestrator.js')) === orig['orchestrator.js']);
ok('tools 逐字节回到原样', sha(path.join(src, 'tools.js')) === orig['tools.js']);
ok('还原留了打补丁那份副本', fs.readdirSync(src).some((f) => f.startsWith('orchestrator.js.patched-')));

console.log('· 锚点对不上时一个字都不改');
const broken = path.join(TMP, 'broken');
fs.cpSync(app, broken, { recursive: true });
const bf = path.join(broken, 'src', 'orchestrator.js');
fs.writeFileSync(bf, fs.readFileSync(bf, 'utf8').replace('const muteRate = moodMuteRate(moodReaction, cfg);', 'const muteRate = 0; // 别人改过'), 'utf8');
const h0 = sha(bf);
let r4;
try {
  execFileSync(process.execPath, [path.join(broken, 'plugins', 'qq-agent-mood', 'patch', 'install.mjs')], { encoding: 'utf8' });
  r4 = { code: 0, out: '' };
} catch (e) { r4 = { code: e.status ?? 1, out: `${e.stdout || ''}` }; }
ok('报错退出', r4.code !== 0, r4.out);
ok('文件一个字节都没改', sha(bf) === h0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`临时目录：${TMP}`);
process.exit(fail ? 1 : 0);
