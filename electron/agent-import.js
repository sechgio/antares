'use strict';

// Importación del historial JSON del agente (<datos>/ai-agent/) a la
// transcripción durable de pi-durable. Idempotente por `legacy_id`, resumible
// tras interrupción (progreso en el doc de sesiones) y de solo lectura sobre
// los originales.

const fs = require('node:fs');
const path = require('node:path');

const TERMINAL_CALL_STATUSES = new Set(['done', 'denied', 'failed', 'interrupted']);

function _readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function _apiFor(style) {
  return style === 'anthropic_messages' ? 'anthropic-messages' : 'openai-completions';
}

function _resolveStyle(provider) {
  // Estilo de chat declarado por el catálogo de proveedores compartido.
  try {
    const catalog = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'shared', 'ai-providers-catalog.json'), 'utf8'));
    return (((catalog.providers || {})[provider] || {}).chat || {}).style || 'openai_chat';
  } catch {
    return 'openai_chat';
  }
}

function _assistantMessage(msg, session, ts) {
  const content = [];
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const call of msg.tool_calls || []) {
    content.push({
      type: 'toolCall',
      id: String(call.id),
      name: String(call.name),
      arguments: call.params && typeof call.params === 'object' ? call.params : {},
    });
  }
  return {
    role: 'assistant',
    content,
    api: _apiFor(session.style || _resolveStyle(session.provider)),
    provider: session.provider,
    model: session.model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: {} },
    stopReason: content.some((b) => b.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: ts,
  };
}

function _entryFor(msg, session, pendingCalls) {
  const ts = typeof msg.ts === 'number' ? msg.ts : 0;
  if (msg.role === 'user') {
    return {
      kind: 'pi.user',
      model: [{ role: 'user', content: String(msg.content || ''), timestamp: ts }],
      data: { ts },
    };
  }
  if (msg.role === 'tool_result') {
    const text = String(msg.content || '');
    let isError = false;
    try { isError = !!JSON.parse(text).error; } catch { /* texto plano */ }
    return {
      kind: 'pi.tool-result',
      model: [{
        role: 'toolResult',
        toolCallId: String(msg.tool_use_id || ''),
        toolName: String(msg.name || ''),
        content: [{ type: 'text', text }],
        isError,
        timestamp: ts,
      }],
      data: { ts },
    };
  }
  if (msg.role === 'assistant') {
    // Estados no terminales persistidos por un cierre no se reanudan: se
    // normalizan a "interrupted" salvo que la aprobación siga pendiente
    // (en ese caso la decisión sigue exigiéndose una única vez).
    const tool_calls = (msg.tool_calls || []).map((call) => {
      const next = { ...call };
      if (!TERMINAL_CALL_STATUSES.has(next.status) && !pendingCalls.has(next.id)) {
        next.status = 'interrupted';
        next.result = next.result || null;
      } else if (pendingCalls.has(next.id)) {
        next.status = 'pending';
      }
      return next;
    });
    return {
      kind: 'pi.assistant',
      model: [_assistantMessage(msg, session, ts)],
      data: { ts, tool_calls },
    };
  }
  return null;
}

/**
 * Importa las sesiones JSON de `sourceDir` (por defecto el `ai-agent` de datos
 * de usuario) en el runtime ya abierto. Devuelve {imported, skipped}.
 */
async function importLegacySessions(runtime, sourceDir) {
  const { dir, ctx } = runtime;
  const source = sourceDir || dir;
  const sessionsJson = _readJson(path.join(source, 'sessions.json'), {});
  const approvals = _readJson(path.join(source, 'approvals.json'), {});
  const pendingCalls = new Set(
    Object.values(approvals)
      .filter((a) => a && a.status === 'pending')
      .map((a) => a.call_id),
  );
  const legacy = Object.values(sessionsJson).filter((s) => s && s.id);
  if (!legacy.length) return { imported: 0, skipped: 0 };
  legacy.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  let imported = 0;
  let skipped = 0;
  for (const legacySession of legacy) {
    const done = await _importSession(runtime, source, legacySession, pendingCalls, ctx);
    if (done) imported += 1; else skipped += 1;
  }
  return { imported, skipped };
}

async function _importSession(runtime, sourceDir, legacySession, pendingCalls, ctx) {
  const { harness, SessionsDoc, convIndex } = runtime;
  const sessions = (await harness.snapshot(SessionsDoc, ctx))?.sessions || {};
  let record = Object.values(sessions).find((s) => s.legacy_id === legacySession.id);
  if (!record && sessions[legacySession.id]) record = sessions[legacySession.id];

  const messagesPath = path.join(sourceDir, 'messages', `${legacySession.id}.json`);
  const messages = _readJson(messagesPath, []);
  if (!Array.isArray(messages)) return false;

  if (!record) {
    const conv = await harness.createConversation({
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: String(legacySession.provider || ''), modelId: String(legacySession.model || '') } },
    }, ctx);
    record = {
      id: String(legacySession.id),
      legacy_id: String(legacySession.id),
      conversationId: conv.id,
      title: String(legacySession.title || 'Conversación'),
      provider: String(legacySession.provider || ''),
      model: String(legacySession.model || ''),
      style: null,
      created_at: legacySession.created_at || Date.now(),
      updated_at: legacySession.updated_at || Date.now(),
      last_error: legacySession.last_error || null,
      import: { done: 0, total: messages.length },
    };
    await harness.commit(async (tx) => {
      const doc = await tx.doc(SessionsDoc);
      doc.sessions[record.id] = record;
    }, ctx);
    convIndex.set(conv.id, record.id);
  }
  if (!record.import || record.import.done >= messages.length) return false;

  const conv = await harness.conversation(record.conversationId, ctx);
  if (!conv) return false;
  for (let i = record.import.done; i < messages.length; i++) {
    const entry = _entryFor(messages[i], record, pendingCalls);
    if (entry) {
      await conv.submit({ type: 'write', entry }, ctx);
    }
    await harness.commit(async (tx) => {
      const doc = await tx.doc(SessionsDoc);
      const current = doc.sessions[record.id];
      if (current) current.import = { done: i + 1, total: messages.length };
    }, ctx);
  }
  return true;
}

module.exports = { importLegacySessions };
