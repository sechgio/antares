'use strict';

const {
  shared,
  bridge,
  ctx,
  commitSessions,
  conversation,
  providerCallId,
} = require('./agent-shared');

const timing = require('./agent-reasoning-timing');

const NOTICE_KIND = shared.NOTICE_KIND;
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;

const COMPACTION_REASONS = {
  threshold: 'al alcanzar el umbral del contexto',
  overflow: 'el proveedor rechazó el contexto por tamaño',
  manual: 'manual',
};

const NOTIFY_MS = 90;
const notifyTimers = new Map();

function emitChanged(sessionId) {
  if (shared.notify) {
    shared.notify('agent.changed', { session_id: sessionId });
    return;
  }
  try {
    const win = require('./window-manager').getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', 'agent.changed', { session_id: sessionId });
  } catch { }
}

function notifyChanged(convId) {
  if (notifyTimers.has(convId)) return;
  notifyTimers.set(convId, setTimeout(() => {
    notifyTimers.delete(convId);
    const sessionId = shared.convToSession.get(convId);
    if (sessionId) emitChanged(sessionId);
  }, NOTIFY_MS));
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
    if (events.length) notifyChanged(convId);
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
      shared.rounds.delete(convId);
      shared.turns.delete(convId);
      live.run = { inputs: event.inputs };
      break;
    case 'run_end':
      timing.clearThinkingSpans(convId);
      delete live.run;
      delete live.generation;
      live.tools = [];
      for (const id of event.inputs || []) shared.unattendedApps.delete(id);
      break;
    case 'message_start':
      if (event.message && event.message.role === 'assistant') {
        timing.clearThinkingSpans(convId);
        live.generation = { ...live.generation, message: event.message };
        timing.trackThinking(convId, event.message);
      }
      break;
    case 'message_end':
      if (event.entry && event.entry.kind === 'pi.assistant') {
        timing.closeThinkingSpan(convId, event.entry.model && event.entry.model[0]);
        timing.clearThinkingSpans(convId);
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
      timing.trackThinking(convId, next);
      break;
    }
    case 'tool_execution_start':
      live.tools = upsertSlot(live.tools, event, { status: 'running', startedAt: Date.now() });
      break;
    case 'tool_execution_update':
      if (event.output) {
        const slot = (live.tools || []).find((s) => s.callId === event.toolCallId) || {};
        const output = 'set' in event.output
          ? event.output.set
          : String(slot.output || '').slice(event.output.trimStart || 0) + (event.output.append || '');
        live.tools = upsertSlot(live.tools, event, { status: 'running', output });
      }
      break;
    case 'tool_execution_end':
      live.tools = upsertSlot(live.tools, event, { status: 'done', entry: event.entry });
      break;
    case 'inbox_update':
      live.inbox = event.items;
      break;
    case 'compaction_start':
      live.compactions = [...(live.compactions || []), { taskId: event.taskId, reason: event.reason }];
      break;
    case 'compaction_end':
      live.compactions = (live.compactions || []).filter((c) => c.taskId !== event.taskId);
      break;
    case 'task_failed': {
      const sessionId = shared.convToSession.get(convId);
      if (sessionId) {
        commitSessions((sessions) => {
          const session = sessions[sessionId];
          if (session) session.last_error = require('./agent-execution').sanitizeProviderError(event.message).slice(0, 300) || session.last_error;
        }).catch(() => {});
        if (event.kind === 'pi.compaction') {
          conversation(sessionId).then((conv) => conv.submit({
            type: 'write',
            requestId: `compaction-failed:${event.taskId}`,
            entry: { kind: NOTICE_KIND, data: { text: `⚠ La compactación del contexto falló: ${event.message}. `
              + 'El turno se detuvo para no continuar con un contexto incompleto; al reanudar se volverá a intentar.' } },
          }, ctx())).catch(() => {});
        }
      }
      break;
    }
    default:
      break;
  }
  shared.live.set(convId, live);
}

function upsertSlot(tools, event, change) {
  const slots = tools || [];
  if (!slots.some((slot) => slot.callId === event.toolCallId)) {
    return [...slots, { callId: event.toolCallId, name: event.toolName, ...change }];
  }
  return slots.map((slot) => slot.callId === event.toolCallId ? { ...slot, ...change } : slot);
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

function partialReasoning(convId) {
  const live = liveFor(convId);
  return timing.reasoningOf(live.generation && live.generation.message);
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

function userAttachmentsOf(message) {
  if (!message || !Array.isArray(message.content)) return [];
  const context = message.content.findLast((block) => block && block.type === 'text'
    && String(block.text || '').startsWith(shared.CONTEXT_MARKER));
  const marker = `\n${shared.ATTACHMENTS_MARKER}\n`;
  const start = context?.text.lastIndexOf(marker) ?? -1;
  if (start < 0) return [];
  try {
    const items = JSON.parse(context.text.slice(start + marker.length));
    return Array.isArray(items) ? items.filter((item) => item && typeof item.path === 'string'
      && typeof item.folder === 'boolean').map((item) => ({ path: item.path, folder: item.folder })) : [];
  } catch { return []; }
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

function contextTokens(usage) {
  return ['input', 'output', 'cacheRead', 'cacheWrite']
    .reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
}

async function conversationSpend(convId) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const doc = await shared.state.harness.snapshot(shared.deps.pi.UsageDoc, convId, ctx());
  for (const usage of Object.values((doc && doc.models) || {})) {
    totals.input += Number(usage.input) || 0;
    totals.output += Number(usage.output) || 0;
    totals.cacheRead += Number(usage.cacheRead) || 0;
    totals.cacheWrite += Number(usage.cacheWrite) || 0;
    totals.cost += Number(usage.cost && usage.cost.total) || 0;
  }
  return totals;
}

async function projectMessages(conv, session) {
  const convId = session.conversationId;
  const live = liveFor(convId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: session.id })).approvals;
  const pendingByCall = new Map(pending.map((a) => [providerCallId(a.call_id), a]));
  let effects = [];
  try {
    effects = (await bridge('agent_internal_effects', { session_id: session.id })).dispatches || [];
  } catch { }
  const effectByCall = new Map();
  const ambiguousEffects = new Set();
  for (const effect of effects) {
    if (!effect || !effect.call_id) continue;
    const id = providerCallId(effect.call_id);
    if (effectByCall.has(id)) ambiguousEffects.add(id);
    else effectByCall.set(id, effect);
  }
  // Un proveedor puede repetir «call_0» entre turnos. Sin el id de tarea en la
  // entrada, asociar el recibo equivocado sería peor que no mostrar recibo.
  for (const id of ambiguousEffects) effectByCall.delete(id);
  const entries = await allEntries(conv);
  const spend = await conversationSpend(convId);

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
  const lastAssistant = [...entries].reverse().find((entry) => entry.kind === 'pi.assistant');
  const liveRound = live.run && lastAssistant ? lastAssistant.id : null;

  const messages = [];
  // pi.usage es el libro de gasto de la conversación: incluye también las
  // llamadas de resumen de pi-durable, que no dejan entrada de asistente.
  const usage = {
    input: spend.input,
    output: spend.output,
    cached: spend.cacheRead,
    prompt: spend.input + spend.cacheRead + spend.cacheWrite,
    context: 0,
    cost: spend.cost,
    compactions: 0,
  };
  let lastUsageMessage;
  for (const entry of entries) {
    const msg = entry.model && entry.model[0];
    if (entry.kind === 'pi.compaction') usage.compactions += 1;
    if (entry.kind === 'pi.assistant' && msg && msg.usage) {
      lastUsageMessage = msg;
      usage.context = contextTokens(msg.usage);
    }
    if (entry.kind === 'pi.user') {
      if (textOf(msg).startsWith(shared.CHECK_MARKER)) continue;
      const content = userTextOf(msg);
      const attachments = userAttachmentsOf(msg);
      if (content || attachments.length) messages.push({ role: 'user', content,
        ...(attachments.length ? { attachments } : {}), ts: entryTs(entry, msg) });
      continue;
    }
    if (entry.kind === NOTICE_KIND) {
      messages.push({ role: 'assistant', content: String((entry.data && entry.data.text) || ''), notice: true, ts: entryTs(entry, msg) });
      continue;
    }
    if (entry.kind === 'pi.compaction') {
      const raw = textOf(msg);
      const summary = require('./agent-compaction').unwrapCompactionSummary(raw) || raw.trim();
      if (summary) {
        const reason = COMPACTION_REASONS[(entry.data && entry.data.reason)] || 'contexto comprimido';
        messages.push({
          role: 'assistant',
          content: `🗜 Contexto compactado — ${reason}\n\n${summary}`,
          notice: true,
          ts: entryTs(entry, msg),
        });
      }
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
      const tool_calls = calls.map((call) => projectCall(call, resultByCall, slotByCall, pendingByCall, effectByCall, entry, entry.id === liveRound));
      const legacy = Array.isArray(entry.data && entry.data.tool_calls) ? entry.data.tool_calls : null;
      const reasoning = timing.reasoningOf(msg);
      const reasoningMs = timing.partialReasoningMs(convId, reasoning);
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
  if (lastUsageMessage) {
    const turn = lastUsageMessage.usage;
    usage.turn = {
      input: Number(turn.input) || 0,
      output: Number(turn.output) || 0,
      cached: Number(turn.cacheRead) || 0,
      cost: Number(turn.cost && turn.cost.total) || 0,
    };
  }
  const ref = lastUsageMessage || session;
  const model = ref.provider && ref.model ? shared.state.models.getModel(ref.provider, ref.model) : null;
  if (model && Number(model.contextWindow) > 0) usage.window = Number(model.contextWindow);
  return { messages, pending, usage: usage.input + usage.output > 0 ? usage : null };
}

function mergeLegacyCalls(legacy, projected) {
  const byId = new Map(projected.map((c) => [c.id, c]));
  return legacy.map((call) => ({ ...call, ...(byId.get(call.id) || {}) }));
}

function sanitizeUndo(undo) {
  if (!undo || typeof undo !== 'object') return null;
  return {
    available: undo.available === true,
    ...(undo.kind === 'delete' || undo.kind === 'restore' ? { kind: undo.kind } : {}),
    ...(typeof undo.reason === 'string' && undo.reason ? { reason: undo.reason } : {}),
    ...(typeof undo.undone_at === 'number' ? { undone_at: undo.undone_at } : {}),
  };
}

function projectCall(call, resultByCall, slotByCall, pendingByCall, effectByCall, assistantEntry, inLiveRound = false) {
  const spec = shared.toolSpecs.get(call.name);
  const pending = pendingByCall.get(call.id);
  const result = resultByCall.get(`${assistantEntry.id}:${call.id}`);
  const candidate = effectByCall.get(call.id);
  const recovered = !!(candidate && candidate.recovered === true
    && candidate.status === 'succeeded' && /interrump|inciert/i.test(result ? textOf(result.msg) : ''));
  const effect = result && candidate && candidate.method === call.name && (recovered
    ? true
    : result.msg.isError
      ? candidate.status === 'failed' || candidate.status === 'uncertain'
      : candidate.status === 'succeeded' || candidate.status === 'submitted') ? candidate : null;
  const undo = sanitizeUndo(effect && effect.undo);
  const base = {
    id: call.id,
    name: call.name,
    params: call.arguments || {},
    gated: !!(spec && spec.gated),
    dispatch_id: (effect && effect.call_id) || null,
    channel: (pending && pending.channel) || (effect && effect.channel) || (spec && spec.channel) || null,
    approval_source: effect && effect.approval_source && effect.approval_source !== 'none'
      ? effect.approval_source : null,
    ...(effect && effect.recovered ? { recovered: true } : {}),
    ...(undo ? { undo } : {}),
    result: null,
    status: 'queued',
  };
  const legacy = Array.isArray(assistantEntry.data && assistantEntry.data.tool_calls)
    ? assistantEntry.data.tool_calls.find((c) => c && c.id === call.id)
    : null;
  if (legacy && legacy.gated !== undefined) base.gated = !!legacy.gated;

  if (result) {
    if (effect && effect.recovered) {
      base.result = JSON.stringify({ recovered: true, detail: 'La escritura terminó antes de cerrar la aplicación' });
      base.status = 'done';
      return base;
    }
    base.result = textOf(result.msg);
    const diagnostics = (result.entry.data && result.entry.data.diagnostics) || [];
    const blocked = result.msg.isError && diagnostics.some((d) => d && (d.code === 'blocked' || d.code === 'tool_unavailable'));
    // Detener el turno aborta la herramienta: pi-durable conserva su salida parcial
    // como resultado y le añade un aviso <harness> para el modelo que el usuario no necesita.
    const aborted = result.msg.isError && diagnostics.some((d) => d && d.code === 'aborted');
    if (aborted) base.result = base.result.replace(/\n?<harness>\n[\s\S]*?\n<\/harness>\s*$/, '') || INTERRUPTED_RESULT;
    base.status = !result.msg.isError ? 'done' : blocked ? 'denied' : aborted ? 'interrupted' : 'failed';
    try {
      const receipt = JSON.parse(base.result);
      if (receipt.queued === true || receipt.submitted === true) base.status = 'submitted';
      else if (receipt.uncertain === true || receipt.interrupted === true) base.status = 'interrupted';
    } catch { }
    return base;
  }
  if (pending) {
    base.status = 'pending';
    return base;
  }
  const slot = slotByCall.get(call.id);
  if ((slot && slot.status !== 'done') || (!slot && inLiveRound)) {
    base.status = slot && slot.status === 'running' ? 'running' : 'queued';
    if (slot && slot.output) base.output = slot.output;
    if (slot && slot.status === 'running' && slot.startedAt) base.started_at = slot.startedAt;
    return base;
  }
  base.status = 'interrupted';
  base.result = INTERRUPTED_RESULT;
  return base;
}

module.exports = {
  ensureWatcher,
  notifyChanged,
  liveFor,
  isRunning,
  partialText,
  partialReasoning,
  partialReasoningMs: timing.partialReasoningMs,
  allEntries,
  projectMessages,
};
