'use strict';

const { shared, bridge, ctx, commitSessions, conversation, providerCallId } = require('./agent-shared');

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

function emitChanged(payload) {
  if (shared.notify) {
    shared.notify('agent.changed', payload);
    return;
  }
  try {
    const win = require('./window-manager').getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', 'agent.changed', payload);
  } catch {}
}

function notifyChanged(convId, partialOnly = false) {
  const pending = notifyTimers.get(convId);
  if (pending) {
    pending.partialOnly &&= partialOnly;
    return;
  }
  const batch = { partialOnly };
  notifyTimers.set(convId, batch);
  setTimeout(() => {
    notifyTimers.delete(convId);
    const sessionId = shared.convToSession.get(convId);
    if (!sessionId) return;
    const live = liveFor(convId);
    const revision = (live.transcriptRevision ?? 0) + 1;
    live.transcriptRevision = revision;
    shared.live.set(convId, live);
    const partial = batch.partialOnly ? projectPartial(convId) : null;
    emitChanged({ session_id: sessionId, revision, ...(partial ? { partial } : {}) });
  }, NOTIFY_MS);
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
    if (events.length) notifyChanged(convId, events.every((event) => event.type === 'message_update'));
    if (events.some((event) => event.type === 'message_end' && event.entry?.kind === 'pi.compaction')) {
      await require('./agent-runtime').regenerateMemorySnapshot(session.id);
    }
  });
  await require('./agent-runtime').regenerateMemorySnapshot(session.id);
}

function applySnapshot(convId, snapshot) {
  shared.live.set(convId, { ...snapshot, transcriptRevision: liveFor(convId).transcriptRevision ?? 0 });
}

function applyEvent(convId, event) {
  const live = shared.live.get(convId) || { tools: [], inbox: [] };
  switch (event.type) {
    case 'snapshot':
      applySnapshot(convId, event);
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
      let next = { ...message, content: [...(message.content || [])] };
      for (const change of event.changes || []) {
        if (change.type === 'message') {
          next = { ...change.message, content: [...(change.message.content || [])] };
          continue;
        }
        if (
          change.type === 'text_start' ||
          change.type === 'thinking_start' ||
          change.type === 'toolcall_start' ||
          change.type === 'block'
        ) {
          next.content[change.contentIndex] = change.block;
        } else if (change.type === 'text_delta' || change.type === 'thinking_delta') {
          const block = next.content[change.contentIndex];
          if (block)
            next.content[change.contentIndex] = { ...block, text: (block.text || block.thinking || '') + change.delta };
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
        const output =
          'set' in event.output
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
          if (session)
            session.last_error =
              require('./agent-execution').sanitizeProviderError(event.message).slice(0, 300) || session.last_error;
        }).catch(() => {});
        if (event.kind === 'pi.compaction') {
          conversation(sessionId)
            .then((conv) =>
              conv.submit(
                {
                  type: 'write',
                  requestId: `compaction-failed:${event.taskId}`,
                  entry: {
                    kind: NOTICE_KIND,
                    data: {
                      text:
                        `⚠ La compactación del contexto falló: ${event.message}. ` +
                        'El turno se detuvo para no continuar con un contexto incompleto; al reanudar se volverá a intentar.',
                    },
                  },
                },
                ctx(),
              ),
            )
            .catch(() => {});
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
  return slots.map((slot) => (slot.callId === event.toolCallId ? { ...slot, ...change } : slot));
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

function projectPartial(convId) {
  const content = partialText(convId);
  const reasoning = partialReasoning(convId);
  if (!content && !reasoning) return null;
  const reasoningMs = timing.partialReasoningMs(convId, reasoning);
  return {
    role: 'assistant', content, partial: true,
    ts: liveFor(convId).generation?.message?.timestamp ?? Date.now(),
    ...(reasoning ? { reasoning } : {}),
    ...(reasoningMs === undefined ? {} : { reasoning_ms: reasoningMs }),
  };
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
  const context = message.content.findLast(
    (block) => block && block.type === 'text' && String(block.text || '').startsWith(shared.CONTEXT_MARKER),
  );
  const marker = `\n${shared.ATTACHMENTS_MARKER}\n`;
  const start = context?.text.lastIndexOf(marker) ?? -1;
  if (start < 0) return [];
  try {
    const items = JSON.parse(context.text.slice(start + marker.length));
    return Array.isArray(items)
      ? items
          .filter((item) => item && typeof item.path === 'string' && typeof item.folder === 'boolean')
          .map((item) => ({ path: item.path, folder: item.folder }))
      : [];
  } catch {
    return [];
  }
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

const TRANSCRIPT_PAGE_SIZE = 100;

function visibleUser(entry) {
  return entry.kind === 'pi.user' && !textOf(entry.model?.[0]).startsWith(shared.CHECK_MARKER);
}

async function transcriptEntries(conv, before) {
  const query = before === undefined ? {} : { maxEntryId: before - 1 };
  const entries = [];
  let cursor;
  do {
    const page = await conv.entries(query, TRANSCRIPT_PAGE_SIZE, cursor, ctx());
    entries.push(...page.items);
    cursor = page.nextCursor;
    const boundary = entries.findLastIndex(visibleUser);
    if (boundary >= 0 && (cursor || boundary < entries.length - 1)) {
      return { entries: entries.slice(0, boundary + 1).reverse(), before: entries[boundary].id };
    }
  } while (cursor);
  return { entries: entries.reverse(), before: null };
}

async function transcriptAround(conv, id) {
  const newest = (await conv.entries({}, 1, undefined, ctx())).items[0]?.id ?? id;
  let minEntryId = id + 1;
  for (let width = 200; minEntryId <= newest; width *= 2) {
    const maxEntryId = Math.min(minEntryId + width - 1, newest);
    let cursor;
    let nextTurn;
    do {
      const page = await conv.entries({ minEntryId, maxEntryId }, TRANSCRIPT_PAGE_SIZE, cursor, ctx());
      const user = page.items.findLast(visibleUser);
      if (user) nextTurn = user.id;
      cursor = page.nextCursor;
    } while (cursor);
    if (nextTurn !== undefined) return transcriptEntries(conv, nextTurn);
    minEntryId = maxEntryId + 1;
  }
  return transcriptEntries(conv);
}

async function searchTranscript(conv, query) {
  const words = query.toLocaleLowerCase('es').split(/\s+/);
  const matches = [];
  let cursor;
  for (let index = 0; index < 20; index += 1) {
    const page = await conv.entries({}, 200, cursor, ctx());
    for (const entry of page.items) {
      const message = entry.model?.[0];
      const content = visibleUser(entry) ? userTextOf(message) : entry.kind === 'pi.assistant' ? textOf(message) : '';
      const normalized = content.toLocaleLowerCase('es');
      if (!content || !words.every((word) => normalized.includes(word))) continue;
      const start = Math.max(0, normalized.indexOf(words[0]) - 45);
      matches.push({ id: entry.id, text: content.slice(start, start + 220), ts: entryTs(entry, message) });
      if (matches.length === 30) return { matches, truncated: true };
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return { matches, truncated: !!cursor };
}

async function transcriptOrigin(conv, kind, ref) {
  let cursor;
  let callId;
  do {
    const page = await conv.entries({}, 500, cursor, ctx());
    for (const entry of page.items) {
      if (kind === 'task') {
        if (entry.kind === NOTICE_KIND && entry.data?.handoff?.task_id === ref) return entry.id;
        continue;
      }
      const message = entry.model?.[0];
      if (entry.kind === 'pi.assistant' && callId &&
          message?.content?.some?.((block) => block.type === 'toolCall' && block.id === callId)) return entry.id;
      if (entry.kind !== 'pi.tool-result' || callId || !message?.toolCallId) continue;
      const content = textOf(message);
      if (!content.includes(ref)) continue;
      try {
        if (JSON.parse(content)?.artifact?.id === ref) callId = message.toolCallId;
      } catch {
        // The same tool result channel also carries ordinary text.
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

function contextTokens(usage) {
  return ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
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

async function projectMessages(conv, session, entriesOverride, historical = false) {
  const convId = session.conversationId;
  const live = historical ? {} : liveFor(convId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: session.id })).approvals;
  const pendingByCall = new Map(pending.map((a) => [providerCallId(a.call_id), a]));
  let effects = [];
  try {
    effects = (await bridge('agent_internal_effects', { session_id: session.id })).dispatches || [];
  } catch {}
  const effectByCall = new Map();
  const ambiguousEffects = new Set();
  for (const effect of effects) {
    if (!effect || !effect.call_id) continue;
    const id = providerCallId(effect.call_id);
    if (effectByCall.has(id)) ambiguousEffects.add(id);
    else effectByCall.set(id, effect);
  }
  for (const id of ambiguousEffects) effectByCall.delete(id);
  const entries = entriesOverride ?? await allEntries(conv);
  const entryId = (entry) => entriesOverride ? { id: entry.id } : {};
  const handoffTasks = entries.some((entry) => entry.kind === NOTICE_KIND && entry.data?.handoff)
    ? (await shared.state.harness.snapshot(shared.state.TasksDoc, ctx()))?.tasks
    : undefined;
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
      if (content || attachments.length)
        messages.push({
          role: 'user',
          ...entryId(entry),
          content,
          ...(attachments.length ? { attachments } : {}),
          ts: entryTs(entry, msg),
        });
      continue;
    }
    if (entry.kind === NOTICE_KIND) {
      const handoff = entry.data?.handoff;
      const task = handoff && handoffTasks?.[handoff.task_id];
      messages.push({
        role: 'assistant',
        ...entryId(entry),
        content: String((entry.data && entry.data.text) || ''),
        notice: true,
        ...(handoff ? { handoff: { ...handoff, ...(task ? { status: task.status } : {}) } } : {}),
        ts: entryTs(entry, msg),
      });
      continue;
    }
    if (entry.kind === 'pi.compaction') {
      const { unwrapCompactionSummary, isEmergencySummary } = require('./agent-compaction');
      const raw = textOf(msg);
      if (isEmergencySummary(unwrapCompactionSummary(raw) || raw.trim())) {
        const reason = COMPACTION_REASONS[entry.data && entry.data.reason] || 'contexto comprimido';
        messages.push({
          role: 'assistant',
          ...entryId(entry),
          content:
            `⚠ Contexto compactado con un resumen de emergencia — ${reason}. ` +
            'El modelo no pudo resumir y se conservó un extracto mecánico; puede faltar detalle de lo anterior.',
          notice: true,
          ts: entryTs(entry, msg),
        });
      }
      continue;
    }
    if (entry.kind === 'pi.tool-result' && msg) {
      if (entriesOverride) continue;
      messages.push({
        role: 'tool_result',
        ...entryId(entry),
        tool_use_id: msg.toolCallId,
        name: msg.toolName,
        content: textOf(msg),
        ts: entryTs(entry, msg),
      });
      continue;
    }
    if (entry.kind === 'pi.assistant' && msg) {
      const calls = (msg.content || []).filter((block) => block && block.type === 'toolCall');
      const tool_calls = calls.map((call) =>
        projectCall(call, resultByCall, slotByCall, pendingByCall, effectByCall, entry, entry.id === liveRound),
      );
      const legacy = Array.isArray(entry.data && entry.data.tool_calls) ? entry.data.tool_calls : null;
      const reasoning = timing.reasoningOf(msg);
      const reasoningMs = timing.partialReasoningMs(convId, reasoning);
      messages.push({
        role: 'assistant',
        ...entryId(entry),
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
  if (model && Number(model.contextWindow) > 0) usage.window = Number(model.workingWindow || model.contextWindow);
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
  const recovered = !!(
    candidate &&
    candidate.recovered === true &&
    candidate.status === 'succeeded' &&
    /interrump|inciert/i.test(result ? textOf(result.msg) : '')
  );
  const effect =
    result &&
    candidate &&
    candidate.method === call.name &&
    (recovered
      ? true
      : result.msg.isError
        ? candidate.status === 'failed' || candidate.status === 'uncertain'
        : candidate.status === 'succeeded' || candidate.status === 'submitted')
      ? candidate
      : null;
  const undo = sanitizeUndo(effect && effect.undo);
  const base = {
    id: call.id,
    name: call.name,
    params: call.arguments || {},
    gated: !!(spec && spec.gated),
    dispatch_id: (effect && effect.call_id) || null,
    channel: (pending && pending.channel) || (effect && effect.channel) || (spec && spec.channel) || null,
    approval_source:
      effect && effect.approval_source && effect.approval_source !== 'none' ? effect.approval_source : null,
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
    const blocked =
      result.msg.isError && diagnostics.some((d) => d && (d.code === 'blocked' || d.code === 'tool_unavailable'));
    const aborted = result.msg.isError && diagnostics.some((d) => d && d.code === 'aborted');
    if (aborted) base.result = base.result.replace(/\n?<harness>\n[\s\S]*?\n<\/harness>\s*$/, '') || INTERRUPTED_RESULT;
    base.status = !result.msg.isError ? 'done' : blocked ? 'denied' : aborted ? 'interrupted' : 'failed';
    try {
      const receipt = JSON.parse(base.result);
      if (receipt.queued === true || receipt.submitted === true) base.status = 'submitted';
      else if (receipt.uncertain === true || receipt.interrupted === true) base.status = 'interrupted';
    } catch {}
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
  projectPartial,
  transcriptEntries,
  transcriptAround,
  searchTranscript,
  transcriptOrigin,
  allEntries,
  projectMessages,
};
