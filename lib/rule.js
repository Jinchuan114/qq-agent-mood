// 关键词兜底：判官没开、判官失败、超出每日额度时用。
// 原则：宁可漏，不要误。误判比漏判伤人 —— 人家说句反话就被记一笔，比没记更糟。
export const INSULT_RE = /(机器人|人工智障|智障|弱智|傻[逼bB]|神经病|有病吧|滚(蛋|开|远点)|闭嘴|烦不烦|别说话|少说话|你他妈|废物|挺废的|恶心)/i;
export const DISMISSIVE_RE = /(行了|好了好了|多大点事|至于吗|别闹|别气了行不行|小题大做|别矫情)/;
export const PRAISE_RE = /(可爱|好看|漂亮|厉害|聪明|喜欢你|最喜欢|真棒|好乖|想你了|离不开你)/;
export const SOOTHE_RE = /(抱抱|抱你|别难过|不难过|别理他|不生气|我陪你|哄你|摸摸头|没事的|不要难受|心疼|舍不得)/;

/**
 * 关键词判断。
 * 顺序是刻意的：
 *   ① 骂 → insult
 *   ② 敷衍（「行了行了」本身就是在打断话题，不是哄）→ dull
 *   ③ 夸
 *   ④ 哄
 * 同一句里既有骂又有哄（「对不起我错了别生气」），按"先出现的那个"算，因为
 * 人说话的重点通常在句首；真要精确还得靠模型判。
 */
export function ruleKind(text) {
  const t = String(text || '');
  if (!t.trim()) return 'neutral';
  const marks = [];
  const at = (re) => { const m = t.match(re); return m ? m.index : -1; };
  const i1 = at(INSULT_RE); if (i1 >= 0) marks.push(['insult', i1]);
  const i2 = at(DISMISSIVE_RE); if (i2 >= 0) marks.push(['dull', i2]);
  const i3 = at(PRAISE_RE); if (i3 >= 0) marks.push(['praise', i3]);
  const i4 = at(SOOTHE_RE); if (i4 >= 0) marks.push(['soothe', i4]);
  if (!marks.length) return 'neutral';
  marks.sort((a, b) => a[1] - b[1]);
  return marks[0][0];
}

/** 判官和兜底都要落成这六类，别的值一律当 neutral。 */
export const KINDS = ['insult', 'tease', 'dull', 'praise', 'soothe', 'neutral'];

export function normalizeKind(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (KINDS.includes(s)) return s;
  const core = s.replace(/^被/, '');
  if (/^(骂|贬低|insult)/.test(core)) return 'insult';
  if (/^(开玩笑|逗|逗嘴|调侃|tease)/.test(core)) return 'tease';
  if (/^(敷衍|dull|dismiss)/.test(core)) return 'dull';
  if (/^(夸奖|夸|赞美|praise)/.test(core)) return 'praise';
  if (/^(安慰|哄|soothe|comfort)/.test(core)) return 'soothe';
  return 'neutral';
}
