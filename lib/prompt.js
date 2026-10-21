// 每轮往消息尾巴上贴的那几行。
// 原则：只说"现在是什么状态、别报数字"，不教她怎么说话 —— 语气是她自己的事。
import { bandOf, BAND_TEXT } from './score.js';

/**
 * @param {{score:number, since:number, history:Array}} state
 * @param {object} cfg
 * @param {number} now
 * @returns {string} 空串表示这一轮不贴
 */
export function buildMoodLine(state, cfg = {}, now = Date.now()) {
  if (cfg.enabled === false) return '';
  const score = Number(state?.score) || 0;
  const band = bandOf(score, cfg.bands || {});

  // 平常就闭嘴，省 token；想每轮都贴的可以开 alwaysShow
  if (band === 'calm' && cfg.alwaysShow !== true) return '';

  const meta = BAND_TEXT[band] || BAND_TEXT.calm;
  const last = Array.isArray(state?.history) ? state.history[0] : null;
  const ageHours = last ? (now - Number(last.at || now)) / 3600000 : 99;

  const lines = [`【你现在的情绪·${meta.label}】`];
  if (last && ageHours <= 48) {
    const why = String(last.why || '').slice(0, 60);
    const who = String(last.from || '').slice(0, 20);
    const dir = last.delta > 0 ? '那句话让你挺受用的' : '那句话你还记着';
    lines.push(`${who ? who + '说的' : '刚才那'}${why ? `「${why}」` : '那一句'}，${dir}。`);
  }
  lines.push(`${meta.note}`);
  lines.push('别报分数、别说"我心情值多少"，把它体现在语气、长短和愿不愿意多说上。');
  return lines.join('\n');
}

/** 正面情绪也有话说，但不用像受伤那样直白。 */
export function buildHappyLine(state, cfg = {}, now = Date.now()) {
  const score = Number(state?.score) || 0;
  if (score < Number(cfg.bands?.happy ?? 20)) return '';
  return buildMoodLine(state, { ...cfg, alwaysShow: true }, now);
}
