// 把「这句话算什么」落到分数上。
// 一次判断 = 一次写盘，所以这里只做纯计算 + 交回新状态，写不写由调用方决定。
import { clampScore, decayScore, decayedWeight, bandOf } from './score.js';

/** 六类 → 权重键。neutral 不记。 */
const WEIGHT_KEY = {
  insult: 'insult',
  dull: 'dismissive',
  tease: 'amused',
  praise: 'praise',
  soothe: 'soothe', // 具体取 sootheOwner / sootheOther，看是谁说的
  neutral: null,
};

/** 方向相同的连续计数怎么算：骂/敷衍算「往下」，夸/哄算「往上」，逗嘴单独算。 */
function directionOf(kind) {
  if (kind === 'insult' || kind === 'dull') return 'down';
  if (kind === 'praise' || kind === 'soothe') return 'up';
  if (kind === 'tease') return 'tease';
  return '';
}

/**
 * 记一笔。
 *
 * @param {'insult'|'tease'|'dull'|'praise'|'soothe'|'neutral'} kind
 * @param {object} opts
 * @param {object} opts.state      当前状态（readState 的结果）
 * @param {object} opts.cfg        合并后的配置
 * @param {boolean} opts.isOwner   说这话的人是不是主人
 * @param {string} opts.why        一句话理由（面板上会显示）
 * @param {string} opts.from       谁（只存昵称）
 * @param {number} opts.now        现在的时间戳（测试可注入）
 * @param {boolean} opts.deterministic  她自己调的：不做随机分叉
 * @returns {{state: object, delta: number, score: number, band: string}}
 */
export function applyKind(kind, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const cfg = opts.cfg || {};
  const bands = cfg.bands || {};
  const weights = cfg.weights || {};
  const perHour = Number(cfg.decayPerHour ?? 6);

  const prev = opts.state || { score: 0, at: now, since: now, history: [], streak: {} };
  // 先把这段时间的自然回落算掉，再叠这一笔，否则"睡一觉回来"那几小时白等了
  const before = decayScore(Number(prev.score) || 0, prev.since ?? prev.at ?? now, now, perHour);

  const key = WEIGHT_KEY[kind] || null;
  if (!key) {
    return {
      state: { ...prev, score: before, at: now, since: now },
      delta: 0, score: before, band: bandOf(before, bands),
    };
  }

  const rawW = kind === 'soothe'
    ? Number(opts.isOwner ? weights.sootheOwner : weights.sootheOther) || 0
    : Number(weights[key]) || 0;

  // 脾气倍率：乘在权重上，不乘分数
  const temper = Number(cfg.temperScale ?? 1) || 1;

  // 同方向的连续递减（换个方向就从头算）
  const dir = directionOf(kind);
  const streak = prev.streak && typeof prev.streak === 'object' ? prev.streak : {};
  const sameDir = streak.dir === dir && dir ? Number(streak.n) || 0 : 0;

  let delta = decayedWeight(rawW * temper, sameDir, cfg.decayStrength || '中');
  delta = Math.round(delta);

  const next = clampScore(before + delta, Number(cfg.min ?? -100), Number(cfg.max ?? 100));

  const history = Array.isArray(prev.history) ? prev.history.slice() : [];
  if (delta !== 0) {
    history.unshift({
      at: now,
      kind,
      delta,
      why: String(opts.why || '').slice(0, 120),
      from: String(opts.from || '').slice(0, 40),
    });
  }

  return {
    state: {
      ...prev,
      score: next,
      at: now,
      since: now,          // ⚠️ 必须刷：沿用旧的 since 会把同一段时间重复扣
      history: history.slice(0, 40),
      streak: { dir, n: sameDir + 1, at: now },
    },
    delta,
    score: next,
    band: bandOf(next, bands),
  };
}
