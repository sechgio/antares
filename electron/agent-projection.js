'use strict';

const {
  shared,
  bridge,
  ctx,
  commitSessions,
  providerCallId,
} = require('./agent-shared');

const crypto = require('crypto');

const NOTICE_KIND = shared.NOTICE_KIND;
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;

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

async function ensureWatcher(session, context) {
  const convId = session.conversationId;
  if (shared.watchers.has(convId)) return;
  const { pi } = shared.deps;
  const stream = await pi.watchEvents(shared.state.harness, convId, context || ctx());
  shared.watchers.set(convId, stream);
  applySnapshot(convId, stream.snapshot);
  stream.start(async (events) => {
    for (const event of events) applyEvent(convId, event);
  });
}

function applySnapshot(convId, snapshot) {
  shared.live.set(convId, { ...snapshot });
}

function applyEvent(convId, event) {
  const live = shared.live.get(convId) || { tools: [], inbox: [] };
  switch (event.type) {
    case 'snapshot':
      shared.live.set(convId, { ...event });
      return;
    case 'run_start':
      live.run = { inputs: event.inputs };
      break;
    case 'run_end':
      thinkingSpans.delete(convId);
      delete live.run;
      delete live.generation;
      live.tools = [];
      break;
    case 'message_start':
      if (event.message && event.message.role === 'assistant') {
        thinkingSpans.delete(convId);
        live.generation = { ...live.generation, message: event.message };
        trackThinking(convId, event.message);
      }
      break;
    case 'message_end':
      if (event.entry && event.entry.kind === 'pi.assistant') {
        closeThinkingSpan(convId, event.entry.model && event.entry.model[0]);
        thinkingSpans.delete(convId);
        delete live.generation;
      }
      break;
    case 'message_update': {
      const message = live.generation && live.generation.message;
      if (!message) break;
      const next = { ...message, content: [...(message.content || [])] };
      for (const change of event.changes || []) {
        if (change.type === 'message') {
          live.generation.message = change.message;
          break;
        }
        if (change.type === 'text_start' || change.type === 'thinking_start' || change.type === 'toolcall_start' || change.type === 'block') {
          next.content[change.contentIndex] = change.block;
        } else if (change.type === 'text_delta' || change.type === 'thinking_delta') {
          const block = next.content[change.contentIndex];
          if (block) next.content[change.contentIndex] = { ...block, text: (block.text || block.thinking || '') + change.delta };
        }
      }
      live.generation.message = next;
      trackThinking(convId, next);
      break;
    }
    case 'tool_execution_start':
      live.tools = (live.tools || []).map((slot) => slot.callId === event.toolCallId ? { ...slot, status: 'running' } : slot);
      break;
    case 'tool_execution_end':
      live.tools = (live.tools || []).map((slot) => slot.callId === event.toolCallId
        ? { ...slot, status: 'done', entry: event.entry }
        : slot);
      break;
    case 'inbox_update':
      live.inbox = event.items;
      break;
    case 'task_failed': {
      const sessionId = shared.convToSession.get(convId);
      if (sessionId) {
        commitSessions((sessions) => {
          const session = sessions[sessionId];
          if (session) session.last_error = require('./agent-execution').sanitizeProviderError(event.message).slice(0, 300) || session.last_error;
        }).catch(() => {});
      }
      break;
    }
    default:
      break;
  }
  shared.live.set(convId, live);
}

function liveFor(convId) {
  return shared.live.get(convId) || { tools: [], inbox: [] };
}

function isRunning(convId) {
  const live = liveFor(convId);
  return !!(live.run || (live.inbox && live.inbox.length > 0));
}

function partialText(convId) {
  const live = liveFor(convId);
  const message = live.generation && live.generation.message;
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('');
}

function reasoningOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'thinking')
    .map((block) => block.text || block.thinking || '')
    .join('\n\n')
    .trim();
}

function partialReasoning(convId) {
  const live = liveFor(convId);
  return reasoningOf(live.generation && live.generation.message);
}

function partialReasoningMs(convId, text) {
  return reasoningTime(convId, text);
}

function textOf(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('');
}

function userTextOf(message) {
  if (!message || typeof message.content === 'string') return textOf(message);
  return (message.content || [])
    .filter((block) => block && block.type === 'text' && !String(block.text || '').startsWith(shared.CONTEXT_MARKER))
    .map((block) => block.text || '')
    .join('');
}

function entryTs(entry, message) {
  if (message && typeof message.timestamp === 'number') return message.timestamp;
  if (entry.data && typeof entry.data.ts === 'number') return entry.data.ts;
  return 0;
}

async function allEntries(conv) {
  const entries = [];
  let cursor;
  do {
    const page = await conv.entries({}, 500, cursor, ctx());
    entries.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return entries.reverse();
}

async function projectMessages(conv, session) {
  const convId = session.conversationId;
  const live = liveFor(convId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: session.id })).approvals;
  const pendingByCall = new Map(pending.map((a) => [providerCallId(a.call_id), a]));
  const entries = await allEntries(conv);

  const resultByCall = new Map();
  let assistantId = '';
  for (const entry of entries) {
    if (entry.kind === 'pi.assistant') assistantId = entry.id;
    if (entry.kind !== 'pi.tool-result') continue;
    const msg = entry.model && entry.model[0];
    const key = msg && `${assistantId}:${msg.toolCallId}`;
    if (msg && !resultByCall.has(key)) resultByCall.set(key, { entry, msg });
  }
  const slotByCall = new Map((live.tools || []).map((slot) => [slot.callId, slot]));

  const messages = [];
  const usage = { input: 0, output: 0, context: 0 };
  for (const entry of entries) {
    const msg = entry.model && entry.model[0];
    if (entry.kind === 'pi.assistant' && msg && msg.usage) {
      usage.input += Number(msg.usage.input) || 0;
      usage.output += Number(msg.usage.output) || 0;
      usage.context = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, key) => sum + (Number(msg.usage[key]) || 0), 0);
    }
    if (entry.kind === 'pi.user') {
      messages.push({ role: 'user', content: userTextOf(msg), ts: entryTs(entry, msg) });
      continue;
    }
    if (entry.kind === NOTICE_KIND) {
      messages.push({ role: 'assistant', content: String((entry.data && entry.data.text) || ''), ts: entryTs(entry, msg) });
      continue;
    }
    if (entry.kind === 'pi.tool-result' && msg) {
      messages.push({
        role: 'tool_result',
        tool_use_id: msg.toolCallId,
        name: msg.toolName,
        content: textOf(msg),
        ts: entryTs(entry, msg),
      });
      continue;
    }
    if (entry.kind === 'pi.assistant' && msg) {
      const calls = (msg.content || []).filter((block) => block && block.type === 'toolCall');
      const tool_calls = calls.map((call) => projectCall(call, resultByCall, slotByCall, pendingByCall, entry));
      const legacy = Array.isArray(entry.data && entry.data.tool_calls) ? entry.data.tool_calls : null;
      const reasoning = reasoningOf(msg);
      const reasoningMs = reasoningTime(convId, reasoning);
      messages.push({
        role: 'assistant',
        content: textOf(msg),
        ...(reasoning ? { reasoning } : {}),
        ...(reasoningMs !== undefined ? { reasoning_ms: reasoningMs } : {}),
        ...(tool_calls.length ? { tool_calls } : {}),
        ...(legacy ? { tool_calls: mergeLegacyCalls(legacy, tool_calls) } : {}),
        ts: entryTs(entry, msg),
      });
      continue;
    }
  }
  return { messages, pending, usage: usage.input + usage.output > 0 ? usage : null };
}

function mergeLegacyCalls(legacy, projected) {
  const byId = new Map(projected.map((c) => [c.id, c]));
  return legacy.map((call) => ({ ...call, ...(byId.get(call.id) || {}) }));
}

function projectCall(call, resultByCall, slotByCall, pendingByCall, assistantEntry) {
  const base = {
    id: call.id,
    name: call.name,
    params: call.arguments || {},
    gated: !!(shared.toolSpecs.get(call.name) && shared.toolSpecs.get(call.name).gated),
    result: null,
    status: 'queued',
  };
  const legacy = Array.isArray(assistantEntry.data && assistantEntry.data.tool_calls)
    ? assistantEntry.data.tool_calls.find((c) => c && c.id === call.id)
    : null;
  if (legacy && legacy.gated !== undefined) base.gated = !!legacy.gated;

  const result = resultByCall.get(`${assistantEntry.id}:${call.id}`);
  if (result) {
    base.result = textOf(result.msg);
    const diagnostics = (result.entry.data && result.entry.data.diagnostics) || [];
    const blocked = result.msg.isError && diagnostics.some((d) => d && (d.code === 'blocked' || d.code === 'tool_unavailable'));
    base.status = !result.msg.isError ? 'done' : blocked ? 'denied' : 'failed';
    try {
      const receipt = JSON.parse(base.result);
      if (receipt.queued === true || receipt.submitted === true) base.status = 'submitted';
      else if (receipt.uncertain === true || receipt.interrupted === true) base.status = 'interrupted';
    } catch { }
    return base;
  }
  if (pendingByCall.has(call.id)) {
    base.status = 'pending';
    return base;
  }
  const slot = slotByCall.get(call.id);
  if (slot && slot.status !== 'done') {
    base.status = slot.status === 'running' ? 'running' : 'queued';
    return base;
  }
  base.status = 'interrupted';
  base.result = INTERRUPTED_RESULT;
  return base;
}

module.exports = {
  ensureWatcher,
  liveFor,
  isRunning,
  partialText,
  partialReasoning,
  partialReasoningMs,
  allEntries,
  projectMessages,
};
