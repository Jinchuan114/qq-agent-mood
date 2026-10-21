// 自测：只测纯函数 + 一次「记两笔」的完整链路。不联网、不碰应用、不写真实数据。
// 跑法：node test/run.mjs
import { clampScore, decayScore, bandOf, decayedWeight } from '../lib/score.js';
import { ruleKind, normalizeKind } from '../lib/rule.js';
import { applyKind } from '../lib/apply.js';
import { buildMoodLine } from '../lib/prompt.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`); }
};
const near = (name, got, want, tol = 0.01) => {
  const ok = Math.abs(Number(got) - Number(want)) <= tol;
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}：期望≈${want}，实际 ${got}`); }
};

console.log('· 分数');
eq('夹取上限', clampScore(180), 100);
eq('夹取下限', clampScore(-180), -100);
eq('非数字当 0', clampScore('abc'), 0);
eq('负数回落不穿越 0', decayScore(-3, 0, 10 * 3600000, 6), 0);
eq('正数回落不穿越 0', decayScore(5, 0, 10 * 3600000, 6), 0);
near('−60 过 1 小时（每小时 6）', decayScore(-60, 0, 3600000, 6), -54);

console.log('· 档位');
const bands = { ignore: -60, hurt: -20, happy: 20, glad: 60 };
eq('-70 → 懒得理', bandOf(-70, bands), 'ignore');
eq('-40 → 不高兴', bandOf(-40, bands), 'hurt');
eq('0 → 平常', bandOf(0, bands), 'calm');
eq('30 → 高兴', bandOf(30, bands), 'happy');
eq('70 → 特别高兴', bandOf(70, bands), 'glad');

console.log('· 递减');
eq('第一次不打折', decayedWeight(-40, 0), -40);
near('第二次 −40 → −25', decayedWeight(-40, 1), -25, 0.5);
near('第三次 −40 → −18.2', decayedWeight(-40, 2), -18.18, 0.5);
eq('关掉递减', decayedWeight(-40, 5, '关'), -40);

console.log('· 关键词兜底');
eq('骂她', ruleKind('你这个人真废物'), 'insult');
eq('敷衍', ruleKind('行了行了别闹了'), 'dull');
eq('夸', ruleKind('你今天怎么这么可爱'), 'praise');
eq('哄', ruleKind('别难过了，我陪你'), 'soothe');
eq('普通', ruleKind('今天天气不错'), 'neutral');
eq('骂在前、哄在后 → 按先出现的算', ruleKind('废物，别难过了'), 'insult');
eq('只有哄', ruleKind('对不起，别难过了'), 'soothe');
eq('裸词归类', normalizeKind('insult'), 'insult');
eq('中文归类', normalizeKind('被夸'), 'praise');
eq('乱写归 neutral', normalizeKind('???'), 'neutral');

console.log('· 记两笔（完整链路）');
const cfg = {
  bands, weights: { insult: -40, dismissive: -10, amused: -12, praise: 12, sootheOwner: 35, sootheOther: 8 },
  temperScale: 1, decayStrength: '中', decayPerHour: 0, min: -100, max: 100,
};
const t0 = 1_700_000_000_000;
let st = { score: 0, at: t0, since: t0, history: [], streak: {} };
const r1 = applyKind('insult', { state: st, cfg, isOwner: false, why: '傻鱼', from: '群友', now: t0 });
eq('被骂 −40', r1.score, -40);
eq('落到不高兴', r1.band, 'hurt');
const r2 = applyKind('soothe', { state: r1.state, cfg, isOwner: true, why: '舍不得骂你', from: '主人', now: t0 + 60000 });
eq('被主人哄 +35 回到 −5', r2.score, -5);
eq('换个方向不递减', r2.delta, 35);
eq('历史记了两笔', r2.state.history.length, 2);
const r3 = applyKind('insult', { state: r2.state, cfg, isOwner: false, why: '再骂', from: '群友', now: t0 + 120000 });
eq('被骂两次方向不同不连击', r3.delta, -40);
const r4 = applyKind('insult', { state: r3.state, cfg, isOwner: false, why: '还骂', from: '群友', now: t0 + 180000 });
near('连着骂第二次开始打折', r4.delta, -25, 0.5);

console.log('· 她自己的记录（确定性，不随机）');
let seed = 0;
for (let i = 0; i < 50; i += 1) {
  const r = applyKind('insult', { state: { score: 100, at: t0, since: t0, history: [], streak: {} }, cfg, now: t0, deterministic: true });
  if (r.delta === -40) seed += 1;
}
eq('50 次都是 −40，没有随机放掉', seed, 50);

console.log('· 心情行');
const line = buildMoodLine({ score: -40, since: t0, history: [{ at: t0, delta: -40, why: '傻鱼', from: '群友' }] }, cfg, t0 + 60000);
eq('受伤会贴', line.includes('不高兴'), true);
eq('不让她报分数', line.includes('别报分数'), true);
eq('平常不贴（省 token）', buildMoodLine({ score: 0, since: t0, history: [] }, cfg, t0), '');
eq('开了 alwaysShow 就贴', buildMoodLine({ score: 0, since: t0, history: [] }, { ...cfg, alwaysShow: true }, t0).length > 0, true);
eq('关掉插件就不贴', buildMoodLine({ score: -80, since: t0, history: [] }, { ...cfg, enabled: false }, t0), '');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
