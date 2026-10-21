// 只改版本号那一行，保留原文件排版（避免整份重排导致 diff 噪音）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'plugin.json');
const want = process.argv[2];
if (!want || !/^\d+\.\d+\.\d+$/.test(want)) {
  console.error('用法: node scripts/bump.mjs 0.2.2');
  process.exit(1);
}
const raw = fs.readFileSync(file, 'utf8');
const next = raw.replace(/("version"\s*:\s*)"[\d.]+"/, `$1"${want}"`);
if (next === raw) {
  console.log('版本没变或没找到 version 字段');
  process.exit(1);
}
fs.writeFileSync(file, next, 'utf8');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('version =', j.version, '| name =', j.name, '| author =', j.author);
