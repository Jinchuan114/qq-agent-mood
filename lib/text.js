// 从「触发这一轮的那条消息」里取出真正该判情绪的那句话。
//
// 背景（2026-10-22 主人报的 bug）：群里有人发「合并转发」，应用把 75 条聊天记录
// 压成一段文字塞进 triggerEntries[0].text，我的关键词/判官把里面别人的话
// 当成了「在说她」，于是 -54 分、直接掉进「不高兴」。
// 转发记录、拍一拍、纯图片/表情包都不是「对她说的话」，一律不判。

const FORWARD_RE = /^\[(合并转发|转发|聊天记录)/;
const PLACEHOLDER_RE = /^\[(拍一拍|图片|表情包|动画表情|语音|视频|文件|卡片消息|链接分享|回复|引用)/;
const DUMP_RE = /\(QQ:\s*\d+\)/g;

/** 这段文字看起来像「多人聊天记录被压扁」吗（两个人以上的昵称+QQ号） */
export function looksLikeDump(text) {
  const hits = String(text || '').match(DUMP_RE);
  return Boolean(hits && hits.length >= 2);
}

/**
 * @param {Array<{text?: string, senderName?: string, senderId?: string}>} entries
 * @param {string} fallback 老版本应用直接给的 ctx.text
 * @returns {string} 需要判情绪的那句原文；不该判就返回空串
 */
export function triggerLine(entries, fallback = '') {
  const list = Array.isArray(entries) ? entries : [];
  // 只看最后一条：它才是「这轮要回的那句」。拿整批 unread 去判会重复记分。
  const last = [...list].reverse().find((e) => String(e?.text || '').trim());
  const text = String(last?.text || fallback || '').trim();
  if (!text) return '';
  if (FORWARD_RE.test(text)) return '';
  if (looksLikeDump(text)) return '';
  if (PLACEHOLDER_RE.test(text)) return '';
  return text;
}
