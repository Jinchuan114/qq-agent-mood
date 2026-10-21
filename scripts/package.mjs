// 打包：只按白名单收文件，顺手扫一遍有没有夹带隐私。
// 跑法：node scripts/package.mjs   → 生成 dist/qq-agent-mood.zip
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

// 白名单：只有这里列出来的东西会进包
const PICK = [
  'plugin.json',
  'index.js',
  'README.md',
  'LICENSE',
  'lib/score.js',
  'lib/store.js',
  'lib/rule.js',
  'lib/apply.js',
  'lib/judge.js',
  'lib/prompt.js',
  'panel/index.html',
  'panel/server.mjs',
  'patch/install.mjs',
  'patch/README.md',
  'test/run.mjs',
  'test/e2e.mjs',
  'test/patch.mjs',
];

// 绝对不能出现在包里东西（出现就让打包失败）
const FORBID_TEXT = [
  ['他的 QQ 号', '3544181418'],
  ['群号（白色茶话会）', '720380274'],
  ['群号（狗窝）', '833376590'],
  ['群号（我要打求）', '938501344'],
  ['她的 QQ 号', '3875800159'],
  ['本机路径', 'C:\\Users\\Ling'],
  ['本机路径', 'C:/Users/Ling'],
];
// Key 要按形态认，不然 CSS 里的 mask-image 会被误判
const FORBID_RE = [
  ['API Key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['别人家的 Key', /\b(ghp|gho)_[A-Za-z0-9]{20,}/],
];

const STAGE = path.join(OUT, 'qq-agent-mood');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const copied = [];
for (const rel of PICK) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) { console.error(`缺文件：${rel}`); process.exit(1); }
  const to = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied.push(rel);
}

// 扫隐私
const problems = [];
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    const text = fs.readFileSync(p, 'utf8');
    for (const [what, needle] of FORBID_TEXT) {
      if (text.includes(needle)) problems.push(`${path.relative(STAGE, p)} 里出现了${what}（${needle}）`);
    }
    for (const [what, re] of FORBID_RE) {
      const m = text.match(re);
      if (m) problems.push(`${path.relative(STAGE, p)} 里出现了${what}（${m[0].slice(0, 6)}…）`);
    }
  }
};
walk(STAGE);
if (problems.length) {
  console.error('打包中止，发现不该带出去的东西：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

// 打包前再跑一遍自测（懒人模式：不自测就不给你 zip）
try {
  execFileSync(process.execPath, [path.join(ROOT, 'test', 'run.mjs')], { cwd: ROOT, stdio: 'pipe' });
  console.log('· 自测通过（test/run.mjs）');
} catch (e) {
  console.error('自测没过，先修：');
  console.error(String(e.stdout || e.message).split('\n').filter((l) => l.includes('✗')).join('\n'));
  process.exit(1);
}

const zip = path.join(OUT, 'qq-agent-mood.zip');
fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  // 传文件夹本身（不是 STAGE\*）——这样解压出来就是 qq-agent-mood/ 一层，
  // 别人把 zip 解开丢进 plugins\ 就是对的，不用自己再建目录。
  `Compress-Archive -Path '${STAGE}' -DestinationPath '${zip}' -Force`], { stdio: 'pipe' });

const size = (fs.statSync(zip).size / 1024).toFixed(1);
console.log(`\n打包完成：${zip}`);
console.log(`文件 ${copied.length} 个，${size} KB`);
console.log('隐私扫描：干净（没夹带 QQ 号、群号、本机路径、Key）');
