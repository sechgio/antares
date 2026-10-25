'use strict';

// pi-durable resume con un resumen cuando la ventana lo permite; este guardián
// cubre las ventanas pequeñas, donde su corte (20 k de contexto reciente) no
// llega a activarse, y evita que una petición desborde sin compactar.
const KEEP_RECENT_MESSAGES = 8;
const KEEP_RECENT_TOOL_RESULTS = 3;
const KEEP_RECENT_USER_TURNS = 2;
const OLD_TEXT_CHARS = 1200;
const HARD_TEXT_CHARS = 400;
const RESERVE_CAP = 16384;
const RESERVE_FLOOR = 2048;

function requestBudget(contextWindow, maxTokens) {
  const window = Number(contextWindow) || 0;
  if (window <= 0) return 0;
  const answer = Math.min(Number(maxTokens) || 0, Math.max(0, Math.floor(window / 4)), 8192);
  const reserve = Math.min(RESERVE_CAP, Math.max(RESERVE_FLOOR, answer + Math.floor(window * 0.05)));
  return Math.max(1024, window - reserve);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('\n');
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
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
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
  return { ...message, content: [{ type: 'text', text: truncate(text, max) }] };
}

function pruneOldToolResults(messages) {
  const indexes = [];
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'toolResult') indexes.push(index);
  const kept = new Set(indexes.slice(-KEEP_RECENT_TOOL_RESULTS));
  let changed = false;
  const next = messages.map((message, index) => {
    if (message.role !== 'toolResult' || kept.has(index)) return message;
    const chars = contentChars(message.content);
    if (chars <= 160) return message;
    changed = true;
    return {
      ...message,
      content: [{ type: 'text', text: `[Resultado de ${message.toolName || 'herramienta'} omitido para ahorrar contexto: ${chars} caracteres]` }],
    };
  });
  return changed ? next : null;
}

function trimOldMessages(messages) {
  const cutoff = messages.length - KEEP_RECENT_MESSAGES;
  if (cutoff <= 0) return null;
  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= cutoff || message.role === 'system') return message;
    const trimmed = message.role === 'user' ? trimUser(message, OLD_TEXT_CHARS)
      : message.role === 'assistant' ? trimAssistant(message, OLD_TEXT_CHARS)
        : message.role === 'toolResult' ? trimToolResult(message, OLD_TEXT_CHARS) : null;
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
  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= cutoff || message.role === 'system') return message;
    const trimmed = message.role === 'toolResult' ? trimToolResult(message, HARD_TEXT_CHARS)
      : message.role === 'user' ? trimUser(message, HARD_TEXT_CHARS)
        : message.role === 'assistant' ? trimAssistant(message, HARD_TEXT_CHARS) : null;
    if (!trimmed) return message;
    changed = true;
    return trimmed;
  });
  return changed ? next : null;
}

function compactMessages(messages, { budget, estimate }) {
  if (!Array.isArray(messages) || !budget || typeof estimate !== 'function') return undefined;
  if (estimate(messages) <= budget) return undefined;
  let current = messages;
  const stages = [
    pruneOldToolResults,
    trimOldMessages,
    (list) => foldOldTurns(list, KEEP_RECENT_USER_TURNS),
    (list) => foldOldTurns(list, 1),
    hardTrim,
  ];
  for (const stage of stages) {
    if (estimate(current) <= budget) break;
    const next = stage(current);
    if (next) current = next;
  }
  return current === messages ? undefined : current;
}

module.exports = { compactMessages, requestBudget };
