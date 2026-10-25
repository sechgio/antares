'use strict';

const crypto = require('crypto');

const MAX_REASONING_TIMES = 200;
const reasoningTimes = new Map();
const thinkingSpans = new Map();

function reasoningKey(convId, text) {
  return `${convId}:${crypto.createHash('sha1').update(text).digest('hex')}`;
}

function rememberReasoningTime(convId, text, ms) {
  const key = reasoningKey(convId, text);
  reasoningTimes.delete(key);
  reasoningTimes.set(key, ms);
  if (reasoningTimes.size > MAX_REASONING_TIMES) reasoningTimes.delete(reasoningTimes.keys().next().value);
}

function reasoningTime(convId, text) {
  return text ? reasoningTimes.get(reasoningKey(convId, text)) : undefined;
}

function reasoningOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'thinking')
    .map((block) => block.text || block.thinking || '')
    .join('\n\n')
    .trim();
}

function trackThinking(convId, message) {
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  let span = thinkingSpans.get(convId);
  if (!span && blocks.some((block) => block && block.type === 'thinking')) {
    span = { startedAt: Date.now(), closed: false };
    thinkingSpans.set(convId, span);
  }
  if (!span || span.closed) return;
  if (blocks.some((block) => block && (block.type === 'text' || block.type === 'toolCall'))) closeThinkingSpan(convId, message);
}

function closeThinkingSpan(convId, message) {
  const span = thinkingSpans.get(convId);
  if (!span || span.closed) return;
  span.closed = true;
  const text = reasoningOf(message);
  if (text) rememberReasoningTime(convId, text, Date.now() - span.startedAt);
}

function clearThinkingSpans(convId) {
  thinkingSpans.delete(convId);
}

function partialReasoningMs(convId, text) {
  return reasoningTime(convId, text);
}

module.exports = {
  reasoningOf,
  trackThinking,
  closeThinkingSpan,
  clearThinkingSpans,
  partialReasoningMs,
};
