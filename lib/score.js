// 分数运算：夹取、随时间回到 0、分档、连续递减。
// 全是纯函数，没有 IO —— 这样测试不用起应用，也不怕读写顺序。

/** 夹到 [min, max]。 */
export function clampScore(v, min = -100, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

/**
 * 按流逝的时间往 0 靠。
 * 线性回落：每小时回 perHour 分，但不越过 0（−3 分不会因为过了 10 小时变成 +57）。
 * 为什么"读的时候才算"而不是定时任务：应用关掉的那几小时也该算，定时器做不到。
 */
export function decayScore(score, sinceMs, nowMs = Date.now(), perHour = 6) {
  const s = Number(score) || 0;
  if (!s) return 0;
  // ⚠️ 别写成 `Number(sinceMs) || nowMs`：时间戳 0 是合法值，会被当成"没有"
  const from = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : nowMs;
  const hours = Math.max(0, (nowMs - from) / 3600000);
  const back = hours * Math.max(0, Number(perHour) || 0);
  if (back <= 0) return s;
  return s > 0 ? Math.max(0, s - back) : Math.min(0, s + back);
}

/** 分数落在哪一档。 */
export function bandOf(score, bands = {}) {
  const v = Number(score) || 0;
  const ignore = Number(bands.ignore ?? -60);
  const hurt = Number(bands.hurt ?? -20);
  const happy = Number(bands.happy ?? 20);
  const glad = Number(bands.glad ?? 60);
  if (v <= ignore) return 'ignore';
  if (v <= hurt) return 'hurt';
  if (v >= glad) return 'glad';
  if (v >= happy) return 'happy';
  return 'calm';
}

/**
 * 连续同一个方向时的递减系数。
 * 强度：关 0 / 轻 0.4 / 中 1 / 强 1.8 —— 只决定"推几次才推不动"，不改单次权重。
 * n = 这一次之前已经连续推了几次。
 */
export function decayedWeight(w, n = 0, strength = '中') {
  const k = strength === '关' ? 0 : strength === '轻' ? 0.4 : strength === '强' ? 1.8 : 1;
  const times = Math.max(0, Number(n) || 0);
  if (!k || !times) return Number(w) || 0;
  return (Number(w) || 0) / (1 + k * 0.6 * times);
}

/** 一档对应一句「她大概会怎么说话」，面板和 README 都用这个。 */
export const BAND_TEXT = {
  ignore: { label: '懒得理', said: '「……嗯。」', note: '三个字就是全部。不接梗，不问，也不解释。' },
  hurt: { label: '不高兴', said: '「哦。你要说就说吧。」', note: '短，冷，语气词收掉，不主动找话。' },
  calm: { label: '平常', said: '「在的呀，怎么了？」', note: '正常长度，会叫主人，会问一句。' },
  happy: { label: '高兴', said: '「诶——你终于来啦，我等你好久了。」', note: '话多一点，语气词多，会主动找话说。' },
  glad: { label: '特别高兴', said: '「主人主人！你猜我刚才看到什么了——」', note: '连着好几条，一条装不下。' },
};
