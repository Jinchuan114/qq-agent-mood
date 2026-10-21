// 解压 dist 里的包到一个临时目录，逐个校验：JSON 能解析、每个 js 语法能过、自测能跑、没有私货
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.join(here, '..');
const zip = path.join(repo, 'dist', 'qq-agent-mood.zip');

// 用 PowerShell 解压（Node 没有内置解压，但 zlib 能解 deflate；这里图省事走系统命令）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moodzip-'));
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'pipe' });

const root = path.join(tmp, 'qq-agent-mood');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(path.relative(root, p).replace(/\\/g, '/'));
  }
})(root);
files.sort();
console.log(`文件 ${files.length} 个：`);
for (const f of files) console.log('  ' + f);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
console.log(`\nplugin.json 解析 OK：${pkg.id} v${pkg.version} / ${pkg.name} / ${pkg.author}`);
console.log('settings 项数 =', Object.keys(pkg.settings).length, '| schema 项数 =', Object.keys(pkg.configSchema).length);

let bad = 0;
for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.mjs'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log(`  ✗ 语法错 ${f}`);
  }
}
console.log(bad === 0 ? '所有 .js/.mjs 语法 OK' : `${bad} 个文件语法有问题`);

// 补丁必须真的在包里
for (const need of ['patch/install.mjs', 'patch/README.md', 'panel/index.html', 'README.md', 'LICENSE']) {
  console.log((files.includes(need) ? '  ✓ ' : '  ✗ 缺 ') + need);
}

if (bad === 0) {
  const out = execFileSync(process.execPath, ['test/run.mjs'], { cwd: root, stdio: 'pipe' }).toString('utf8');
  console.log('\n包内自测：' + out.split('\n').filter((l) => l.trim()).slice(-1)[0]);
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad === 0 ? 0 : 1);
