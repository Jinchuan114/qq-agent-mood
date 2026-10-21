// 读写本地状态。
// 只写一个文件：<数据目录>/self/qq-agent-mood/mood.json
// 路径三级回退（这条决定"别人装上去会不会写错地方"）：
//   ① 应用自己的数据目录（应用里跑的时候 main.js 已经设好 QQ_AGENT_DATA_DIR）
//   ② 环境变量 QQ_AGENT_DATA_DIR
//   ③ 插件自己目录下的 .data/（兜底，至少不写到 resources 里）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(HERE, '..');

let rootCache = null;
let rootHow = '';

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 只读环境里由写入报错，不在这一步抛 */ }
  return dir;
}

export async function dataRoot() {
  if (rootCache) return rootCache;

  // ① 核心模块（应用内跑时最准）
  try {
    const core = await import('../../../src/config.js');
    if (core?.DATA_DIR) {
      rootCache = path.join(core.DATA_DIR, 'self', 'qq-agent-mood');
      rootHow = 'core:DATA_DIR';
      return ensureDir(rootCache);
    }
  } catch { /* 换版本/路径变了就往下退 */ }

  // ② 环境变量
  const envDir = String(process.env.QQ_AGENT_DATA_DIR || '').trim();
  if (envDir) {
    rootCache = path.join(envDir, 'self', 'qq-agent-mood');
    rootHow = 'env:QQ_AGENT_DATA_DIR';
    return ensureDir(rootCache);
  }

  // ③ 插件自己的目录
  rootCache = path.join(PLUGIN_DIR, '.data');
  rootHow = 'plugin:.data';
  return ensureDir(rootCache);
}

export function dataRootHow() { return rootHow; }

function stateFile() { return path.join(rootCache || ensureDir(path.join(PLUGIN_DIR, '.data')), 'mood.json'); }

const EMPTY = () => ({ score: 0, at: Date.now(), since: Date.now(), history: [], streak: { kind: '', n: 0, at: 0 } });

/** 读状态。坏文件不抛：当作 0 分重新开始，坏文件改名留证。 */
export async function readState() {
  await dataRoot();
  const file = stateFile();
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM（记事本/部分编辑器会加）
    const raw = JSON.parse(text);
    return { ...EMPTY(), ...raw, history: Array.isArray(raw.history) ? raw.history.slice(0, 40) : [] };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* 留不下证据也不阻塞 */ }
    }
    return EMPTY();
  }
}

/** 原子写：先写临时文件再改名，断电也不会留下半个 JSON。 */
export async function writeState(state) {
  await dataRoot();
  const file = stateFile();
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return state;
}

/** 清空（卸载/重置用）。 */
export async function clearState() {
  await dataRoot();
  try { fs.unlinkSync(stateFile()); return true; } catch { return false; }
}

/** 把 manifest 的默认值和用户改过的设置合起来，缺的键补默认。 */
export function mergeConfig(defaults = {}, saved = {}) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(saved || {})) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k]) {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}
