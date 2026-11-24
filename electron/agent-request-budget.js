'use strict';

const KEEP_RECENT_MESSAGES = 8;
const KEEP_RECENT_TOOL_RESULTS = 3;
const KEEP_RECENT_USER_TURNS = 2;
const OLD_TEXT_CHARS = 1200;
const HARD_TEXT_CHARS = 400;
const SAFETY_MARGIN_CAP = 16384;
const RESERVE_FLOOR = 2048;
const CUT_SLACK = 4;

function requestBudget(contextWindow, maxTokens) {
  const window = Number(contextWindow) || 0;
  if (window <= 0) return 0;
  const answer = Math.max(0, Number(maxTokens) || 0);
  const margin = Math.min(SAFETY_MARGIN_CAP, Math.floor(window * 0.05));
  const reserve = Math.max(RESERVE_FLOOR, answer + margin);
  return Math.max(1, window - reserve);
}

function clipMiddle(text, max, marker) {
  if (text.length <= max) return text;
  const half = Math.floor((max - marker.length) / 2);
  return half > 0 ? `${text.slice(0, half)}${marker}${text.slice(-half)}` : text.slice(0, max);
}

function fitSummaryTranscript(parts, priorities, budget, estimate) {
  const transcript = parts.join('\n\n');
  if (estimate(transcript) <= budget) return transcript;

  const notice = '[Se omitió o recortó parte del historial para ajustarlo a la ventana del resumidor.]';
  let remaining = budget - estimate(`${notice}\n\n`);
  const kept = new Map();
  for (const index of priorities) {
    if (index < 0) continue;
    const limit = Math.floor(remaining / 2);
    const part = parts[index];
    // The pi-ai estimator uses four characters per token. Leave room for the separator.
    const bounded =
      estimate(`${part}\n\n`) <= limit ? part : clipMiddle(part, Math.max(0, (limit - 1) * 4), '\n[… recortado …]\n');
    remaining -= estimate(`${bounded}\n\n`);
    kept.set(index, bounded);
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (kept.has(index)) continue;
    const tokens = estimate(`${parts[index]}\n\n`);
    if (tokens > remaining) continue;
    remaining -= tokens;
    kept.set(index, parts[index]);
  }
  return [notice, ...parts.flatMap((_, index) => (kept.has(index) ? [kept.get(index)] : []))].join('\n\n');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}

function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text') chars += String(block.text || '').length;
    else if (block.type === 'image') chars += 4800;
  }
  return chars;
}

function excerpt(text, max) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}… [recortado para ahorrar contexto]`;
}

function trimUser(message, max) {
  if (typeof message.content === 'string') {
    const text = truncate(message.content, max);
    return text === message.content ? null : { ...message, content: text };
  }
  if (!Array.isArray(message.content)) return null;
  let changed = false;
  let image = false;
  const blocks = [];
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      const text = truncate(String(block.text || ''), max);
      if (text !== block.text) changed = true;
      blocks.push(text === block.text ? block : { ...block, text });
    } else if (block.type === 'image') {
      changed = true;
      if (!image) blocks.push({ type: 'text', text: '[imagen anterior omitida para ahorrar contexto]' });
      image = true;
    } else {
      blocks.push(block);
    }
  }
  if (!changed) return null;
  return { ...message, content: blocks.length ? blocks : [{ type: 'text', text: '… [contenido antiguo omitido]' }] };
}

function trimAssistant(message, max) {
  if (!Array.isArray(message.content)) return null;
  let changed = false;
  const blocks = message.content.map((block) => {
    if (!block || block.type !== 'text') return block;
    const text = truncate(String(block.text || ''), max);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...message, content: blocks } : null;
}

function trimToolResult(message, max) {
  const text = textOf(message.content);
  const hasImage = Array.isArray(message.content) && message.content.some((block) => block && block.type === 'image');
  if (text.length <= max && !hasImage) return null;
  const bounded = clipMiddle(text, max, '\n[… recortado para ahorrar contexto …]\n');
  const output = hasImage ? `${bounded}\n[imagen omitida para ahorrar contexto]` : bounded;
  return { ...message, content: [{ type: 'text', text: output }] };
}

function toolResultCount(messages) {
  return messages.filter((message) => message.role === 'toolResult').length;
}

function pruneOldToolResults(messages, cut) {
  const indexes = [];
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'toolResult') indexes.push(index);
  const pruned = new Set(indexes.slice(0, cut));
  let changed = false;
  const next = messages.map((message, index) => {
    if (message.role !== 'toolResult' || !pruned.has(index)) return message;
    const chars = contentChars(message.content);
    if (chars <= 160) return message;
    changed = true;
    return {
      ...message,
      content: [
        {
          type: 'text',
          text: `[Resultado de ${message.toolName || 'herramienta'} omitido para ahorrar contexto: ${chars} caracteres]`,
        },
      ],
    };
  });
  return changed ? next : null;
}

function trimOldMessages(messages, cutoff) {
  if (cutoff <= 0) return null;
  const activeUser = messages.findLastIndex((message) => message.role === 'user');
  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= cutoff || index === activeUser || message.role === 'system') return message;
    const trimmed =
      message.role === 'user'
        ? trimUser(message, OLD_TEXT_CHARS)
        : message.role === 'assistant'
          ? trimAssistant(message, OLD_TEXT_CHARS)
          : message.role === 'toolResult'
            ? trimToolResult(message, OLD_TEXT_CHARS)
            : null;
    if (!trimmed) return message;
    changed = true;
    return trimmed;
  });
  return changed ? next : null;
}

function callPairComplete(group) {
  const calls = new Set();
  const results = new Set();
  for (const message of group) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) if (block && block.type === 'toolCall') calls.add(block.id);
    } else if (message.role === 'toolResult') {
      results.add(message.toolCallId);
    }
  }
  for (const id of calls) if (!results.has(id)) return false;
  for (const id of results) if (!calls.has(id)) return false;
  return true;
}

function summaryOf(dropped) {
  const asks = [];
  const answers = [];
  const tools = new Set();
  for (const message of dropped) {
    if (message.role === 'user') {
      const text = excerpt(textOf(message.content), 160);
      if (text) asks.push(`  - ${text}`);
    } else if (message.role === 'assistant') {
      const text = excerpt(textOf(message.content), 160);
      if (text) answers.push(`  - ${text}`);
      for (const block of message.content || []) if (block && block.type === 'toolCall') tools.add(block.name);
    } else if (message.role === 'toolResult' && message.toolName) {
      tools.add(message.toolName);
    }
  }
  const lines = [
    `[Contexto compactado por Antares: se omitieron ${dropped.length} mensajes anteriores para mantener la conversación dentro de la ventana del modelo.]`,
    '',
    'Resumen de lo omitido:',
    '- Peticiones del usuario:',
    ...(asks.length ? asks : ['  - (sin peticiones registradas)']),
  ];
  if (answers.length) lines.push('- Últimas respuestas del agente:', ...answers.slice(-2));
  if (tools.size) lines.push(`- Herramientas usadas: ${[...tools].join(', ')}`);
  return lines.join('\n');
}

function foldOldTurns(messages, keepTurns) {
  const starts = [];
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'user') starts.push(index);
  if (starts.length <= keepTurns) return null;
  const cutoff = starts[starts.length - keepTurns];
  const dropped = [];
  const systems = [];
  let end = starts[0];
  while (end < cutoff) {
    const nextStart = starts.find((start) => start > end);
    const groupEnd = nextStart === undefined ? messages.length : nextStart;
    const group = messages.slice(end, groupEnd);
    if (!callPairComplete(group)) break;
    for (const message of group) {
      if (message.role === 'system') systems.push(message);
      else dropped.push(message);
    }
    end = groupEnd;
  }
  if (!dropped.length) return null;
  const timestamp = dropped.reduce((latest, message) => Math.max(latest, Number(message.timestamp) || 0), 0);
  const summary = { role: 'user', content: summaryOf(dropped), timestamp: timestamp || Date.now() };
  return [...messages.slice(0, starts[0]), ...systems, summary, ...messages.slice(end)];
}

function hardTrim(messages) {
  const cutoff = Math.max(0, messages.length - 2);
  const activeUser = messages.findLastIndex((message) => message.role === 'user');
  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= cutoff || index === activeUser || message.role === 'system') return message;
    const trimmed =
      message.role === 'toolResult'
        ? trimToolResult(message, HARD_TEXT_CHARS)
        : message.role === 'user'
          ? trimUser(message, HARD_TEXT_CHARS)
          : message.role === 'assistant'
            ? trimAssistant(message, HARD_TEXT_CHARS)
            : null;
    if (!trimmed) return message;
    changed = true;
    return trimmed;
  });
  return changed ? next : null;
}

function trimRecentToolResults(messages) {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'toolResult') return message;
    const trimmed = trimToolResult(message, HARD_TEXT_CHARS);
    changed ||= !!trimmed;
    return trimmed || message;
  });
  return changed ? next : null;
}

function compactMessages(messages, { budget, estimate, messageTokens = (message) => estimate([message]), cuts }) {
  if (!Array.isArray(messages) || !budget || typeof estimate !== 'function') return undefined;
  const measured = estimate(messages);
  if (measured <= budget) return undefined;
  const visible = (list) => list.reduce((sum, message) => sum + messageTokens(message), 0);
  const original = visible(messages);
  const size = (list) => measured - original + visible(list);
  const stable = (stage, key, count, keep) => (list) => {
    const fresh = Math.max(0, count(list) - keep);
    const previous = cuts && cuts[key];
    if (Number.isInteger(previous) && previous < fresh && previous >= fresh - CUT_SLACK) {
      const reused = stage(list, previous);
      if (size(reused || list) <= budget) return reused;
    }
    if (cuts) cuts[key] = fresh;
    return stage(list, fresh);
  };
  let current = messages;
  const stages = [
    stable(pruneOldToolResults, 'toolResults', toolResultCount, KEEP_RECENT_TOOL_RESULTS),
    stable(trimOldMessages, 'messages', (list) => list.length, KEEP_RECENT_MESSAGES),
    (list) => foldOldTurns(list, KEEP_RECENT_USER_TURNS),
    (list) => foldOldTurns(list, 1),
    hardTrim,
    trimRecentToolResults,
  ];
  for (const stage of stages) {
    if (size(current) <= budget) break;
    const next = stage(current);
    if (next) current = next;
  }
  return current === messages ? undefined : current;
}

module.exports = { clipMiddle, compactMessages, fitSummaryTranscript, requestBudget };
