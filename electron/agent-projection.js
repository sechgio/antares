'use strict';

// Proyección del runtime del agente hacia el contrato público: watchEvents de
// pi-durable alimenta el estado en vivo (texto parcial, herramientas en curso)
// y las entradas durables se traducen al formato de messages_list.

const {
  shared,
  bridge,
  ctx,
  commitSessions,
} = require('./agent-shared');

const NOTICE_KIND = shared.NOTICE_KIND;
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;

// ---------- watchEvents: estado en vivo para la UI ----------

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
      delete live.run;
      delete live.generation;
      live.tools = [];
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
          if (session) session.last_error = String(event.message || '').slice(0, 300) || session.last_error;
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

// ---------- proyección del transcript al contrato público ----------

function textOf(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content || [])
    .filter((block) => block && block.type === 'text')
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
  return entries.reverse(); // oldest → newest
}

async function projectMessages(conv, session) {
  const convId = session.conversationId;
  const live = liveFor(convId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: session.id })).approvals;
  const pendingByCall = new Map(pending.map((a) => [a.call_id, a]));
  const entries = await allEntries(conv);

  const resultByCall = new Map();
  for (const entry of entries) {
    if (entry.kind !== 'pi.tool-result') continue;
    const msg = entry.model && entry.model[0];
    if (msg) resultByCall.set(msg.toolCallId, { entry, msg });
  }
  const slotByCall = new Map((live.tools || []).map((slot) => [slot.callId, slot]));

  const messages = [];
  for (const entry of entries) {
    const msg = entry.model && entry.model[0];
    if (entry.kind === 'pi.user') {
      messages.push({ role: 'user', content: textOf(msg), ts: entryTs(entry, msg) });
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
      messages.push({
        role: 'assistant',
        content: textOf(msg),
        ...(tool_calls.length ? { tool_calls } : {}),
        ...(legacy ? { tool_calls: mergeLegacyCalls(legacy, tool_calls) } : {}),
        ts: entryTs(entry, msg),
      });
      continue;
    }
  }
  return { messages, pending };
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

  const result = resultByCall.get(call.id);
  if (result) {
    base.result = textOf(result.msg);
    const diagnostics = (result.entry.data && result.entry.data.diagnostics) || [];
    const blocked = result.msg.isError && diagnostics.some((d) => d && (d.code === 'blocked' || d.code === 'tool_unavailable'));
    base.status = !result.msg.isError ? 'done' : blocked ? 'denied' : 'failed';
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
  allEntries,
  projectMessages,
};
