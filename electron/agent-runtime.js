'use strict';

// Runtime del agente en el proceso principal: pi-durable (SQLite durable) +
// pi-ai (proveedores). Python conserva vault, allowlist, MCP, scheduler y
// aprobaciones a través de los RPC internos `agent_internal_*`, a los que solo
// llega este módulo vía `_callBackend` (el catálogo los marca `internal`).
// Este archivo guarda el ciclo de vida y los diez handlers públicos; la
// ejecución de herramientas/proveedores vive en agent-execution.js y la
// proyección al contrato público en agent-projection.js.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  shared,
  bridge,
  ctx,
  validation,
  sessions,
  commitSessions,
  requireSession,
  conversation,
} = require('./agent-shared');
const execution = require('./agent-execution');
const projection = require('./agent-projection');

const MAX_MESSAGE_CHARS = 12_000;
const MAX_SESSIONS = 50;
const SYSTEM_PROMPT =
  'Eres el agente de Antares, una app de escritorio de documentos e imágenes. ' +
  'Responde en español. Tienes herramientas para consultar el estado de la app ' +
  '(métodos de solo lectura) y herramientas con efectos que el usuario aprueba ' +
  'una a una. Usa herramientas cuando la respuesta dependa de datos reales de la ' +
  'app; si una herramienta requiere aprobación explícale al usuario qué hará.';
const CANCELLED_NOTE =
  '⏹ Turno detenido por el usuario. Una herramienta ya iniciada puede seguir ejecutándose; ' +
  'comprueba su resultado antes de repetirla.';
const NOTICE_KIND = shared.NOTICE_KIND;

let _opening = null;

async function _loadDeps() {
  if (shared.deps) return shared.deps;
  const [pi, chord, aiOpenai, aiAnthropic, { _callBackend }] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/chord/context'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
    import('@earendil-works/pi-ai/api/anthropic-messages.lazy'),
    Promise.resolve(require('./ipc-router')),
  ]);
  shared.deps = { pi, chord, aiOpenai, aiAnthropic, bridge: _callBackend };
  return shared.deps;
}

function _agentDir() {
  const { antaresUserData } = require('./canvas-assets');
  return antaresUserData('ai-agent');
}

function _dbPath() {
  return path.join(_agentDir(), 'agent.sqlite');
}

async function _open(options = {}) {
  await _loadDeps();
  if (options.bridge) shared.deps.bridge = options.bridge;
  if (shared.state) return shared.state;
  if (_opening) return _opening;
  _opening = (async () => {
    const { pi } = shared.deps;
    const dir = options.dir || _agentDir();
    fs.mkdirSync(dir, { recursive: true });
    const storage = options.storage
      || await (await import('@earendil-works/pi-durable/storage/sqlite/node'))
        .openNodeSqliteStorage(options.dbPath || _dbPath());
    const models = (await import('@earendil-works/pi-ai')).createModels();
    const SessionsDoc = pi.defineDoc({
      kind: 'antares.agent.sessions',
      version: 1,
      scope: 'session',
      initial: () => ({ sessions: {} }),
    });
    const registry = pi.createRegistry();
    const harness = await pi.Harness.open(storage, { models, registry }, ctx());
    shared.state = {
      harness,
      models,
      registry,
      SessionsDoc,
      dir,
      ctx: ctx(),
      convIndex: shared.convToSession,
    };
    await _indexConversations();
    if (!options.skipImport) {
      await require('./agent-import').importLegacySessions(shared.state, options.importSourceDir);
    }
    harness.resume();
    return shared.state;
  })();
  try {
    return await _opening;
  } finally {
    _opening = null;
  }
}

async function _indexConversations() {
  const doc = await shared.state.harness.snapshot(shared.state.SessionsDoc, ctx());
  for (const session of Object.values((doc && doc.sessions) || {})) {
    shared.convToSession.set(session.conversationId, session.id);
  }
}

// ---------- handlers públicos (contrato backend:agent) ----------

async function sessionsList() {
  const result = Object.values(await sessions())
    .filter((s) => !s.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .map(({ conversationId, legacy_id, deleted, import: _import, style, ...rest }) => rest);
  return { sessions: result };
}

async function sessionCreate(params) {
  const provider = params && params.provider;
  if (typeof provider !== 'string' || !provider) throw validation('Falta el parámetro provider');
  const info = await execution.providerInfo(provider); // valida chat + clave en Python
  const requested = typeof params.model === 'string' ? params.model : '';
  const model = (requested || String(info.default_model || '')).slice(0, 120);
  const title = String(params.title || '').slice(0, 120);
  await execution.refreshTools();
  await execution.ensureProvider(provider, model);
  const conv = await shared.state.harness.createConversation({
    ownership: { kind: 'ownerless' },
    agent: { model: { provider, modelId: model }, instructions: SYSTEM_PROMPT },
  }, ctx());
  const now = Date.now();
  const session = {
    id: crypto.randomBytes(6).toString('hex'),
    conversationId: conv.id,
    title: title || 'Conversación',
    provider,
    model,
    style: info.style || 'openai_chat',
    created_at: now,
    updated_at: now,
    last_error: null,
  };
  await commitSessions((map) => {
    map[session.id] = session;
    const alive = Object.values(map).filter((s) => !s.deleted);
    if (alive.length > MAX_SESSIONS) {
      alive.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      for (const old of alive.slice(0, alive.length - MAX_SESSIONS)) map[old.id].deleted = true;
    }
  });
  shared.convToSession.set(conv.id, session.id);
  const { conversationId, style, ...publicSession } = session;
  return { session: publicSession };
}

async function sessionDelete(params) {
  const sessionId = String(params && params.id || '');
  const session = await requireSession(sessionId);
  const conv = await conversation(sessionId);
  await conv.abort(ctx(), { background: true }).catch(() => {});
  await bridge('agent_internal_approvals_deny_session', { session_id: sessionId }).catch(() => {});
  await commitSessions((map) => { delete map[sessionId]; });
  const watcher = shared.watchers.get(session.conversationId);
  if (watcher) {
    watcher.stop().catch(() => {});
    shared.watchers.delete(session.conversationId);
  }
  shared.live.delete(session.conversationId);
  shared.convToSession.delete(session.conversationId);
  return { deleted: true, id: sessionId };
}

async function messagesList(params) {
  const sessionId = String(params && params.session_id || '');
  const session = await requireSession(sessionId);
  const conv = await conversation(sessionId);
  await projection.ensureWatcher(session);
  const { messages, pending } = await projection.projectMessages(conv, session);
  const partial = projection.partialText(session.conversationId);
  if (partial) messages.push({ role: 'assistant', content: partial, partial: true, ts: Date.now() });
  return {
    messages,
    running: projection.isRunning(session.conversationId),
    pending_approvals: pending,
  };
}

async function messageSend(params) {
  const sessionId = String(params && params.session_id || '');
  const session = await requireSession(sessionId);
  const content = String(params.content || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!content) throw validation('El mensaje está vacío');
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  if (pending.length) throw validation('Resuelve primero las aprobaciones pendientes de esta conversación');
  await execution.refreshTools();
  await execution.ensureProvider(session.provider, session.model);
  const conv = await conversation(sessionId);
  await projection.ensureWatcher(session);
  shared.rounds.delete(session.conversationId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await conv.submit({ type: 'input', content, whenBusy: 'reject' }, ctx());
      break;
    } catch (err) {
      if (!(err && (err.name === 'ConversationBusy' || /busy/i.test(err.message || '')))) throw err;
      if (attempt === 1) throw validation('Ya hay un turno en curso en esta conversación');
      // Un abort recién resuelto puede dejar el boundary cerrándose un
      // instante: espera acotada a idle antes de rendirse.
      await Promise.race([conv.waitForIdle(ctx()), new Promise((r) => setTimeout(r, 5000))]);
    }
  }
  await commitSessions((map) => {
    const s = map[sessionId];
    if (s) {
      s.updated_at = Date.now();
      if (s.title === 'Conversación') s.title = content.trim().slice(0, 60) || 'Conversación';
    }
  });
  return { accepted: true };
}

async function toolsList() {
  const { tools } = await bridge('agent_internal_tools', {});
  return {
    tools: tools.map((t) => ({ name: t.name, gated: !!t.gated, kind: t.kind === 'mcp' ? 'mcp' : 'backend' })),
  };
}

async function turnStatus(params) {
  const sessionId = String(params && params.session_id || '');
  const session = await requireSession(sessionId);
  await projection.ensureWatcher(session);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  return {
    running: projection.isRunning(session.conversationId),
    pending_approvals: pending,
    last_error: session.last_error || null,
  };
}

async function turnCancel(params) {
  const sessionId = String(params && params.session_id || '');
  const session = await requireSession(sessionId);
  await projection.ensureWatcher(session);
  const live = projection.liveFor(session.conversationId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  const busy = !!live.run || (live.inbox || []).length > 0;
  if (!busy && pending.length === 0) return { cancelled: false };
  const conv = await conversation(sessionId);
  await conv.abort(ctx());
  if (pending.length) await bridge('agent_internal_approvals_deny_session', { session_id: sessionId });
  await conv.submit({
    type: 'write',
    entry: { kind: NOTICE_KIND, data: { text: CANCELLED_NOTE } },
  }, ctx()).catch(() => {});
  return { cancelled: true };
}

async function approve(params, approved) {
  const approvalId = String(params && params.approval_id || '');
  const { approval } = await bridge('agent_internal_approval_decide', { approval_id: approvalId, approve: !!approved });
  execution.notifyDecision(approvalId);
  // Aprobación recuperada tras un reinicio: ninguna espera beforeTool la
  // consume; ejecutamos/negamos una sola vez vía dispatch deduplicado y
  // dejamos constancia en la transcripción. Una espera viva para esa llamada
  // o un tool task en curso la gestionan ellos.
  const liveWait = approval && (
    shared.liveApprovals.has(approval.id)
    || shared.approvalsByCall.has(String(approval.call_id))
    || [...shared.live.values()].some((l) => (l.tools || []).some(
      (t) => t.callId === approval.call_id && t.status !== 'done'))
  );
  if (approval && !liveWait) {
    // Pequeña pausa: una espera recién reanudada puede registrar su marca
    // un instante después de decidirse la aprobación.
    await new Promise((r) => setTimeout(r, 150));
    const stillLive = shared.liveApprovals.has(approval.id) || shared.approvalsByCall.has(String(approval.call_id));
    // Igual que el runner antiguo: la decisión responde ya y el efecto corre
    // en segundo plano; el resultado aparece vía messages_list.
    if (!stillLive) void _settleRecoveredApproval(approval).catch(() => {});
  }
  return { approval };
}

async function _settleRecoveredApproval(approval) {
  const sessionId = String(approval.session_id || '');
  const session = (await sessions())[sessionId];
  if (!session || session.deleted) return;
  const conv = await shared.state.harness.conversation(session.conversationId, ctx());
  if (!conv) return;
  const callId = String(approval.call_id || '');
  const method = String(approval.method || '');

  const already = await _resultEntryFor(conv, callId);
  if (already) return; // el tool task vivo ya escribió el resultado

  let text;
  let isError = false;
  let diagnostics;
  if (approval.status === 'approved') {
    text = await execution.dispatchAndWait({
      session_id: sessionId,
      call_id: callId,
      name: method,
      params: approval.params || {},
      approval_id: approval.id,
    }, ctx());
    try { isError = !!JSON.parse(text).error; } catch { /* texto plano */ }
  } else {
    text = JSON.stringify({ error: 'El usuario rechazó esta acción' });
    isError = true;
    diagnostics = [{ severity: 'info', message: 'denied', code: 'blocked' }];
  }
  await conv.submit({
    type: 'write',
    entry: {
      kind: 'pi.tool-result',
      model: [{
        role: 'toolResult',
        toolCallId: callId,
        toolName: method,
        content: [{ type: 'text', text }],
        isError,
        timestamp: Date.now(),
      }],
      ...(diagnostics ? { data: { diagnostics } } : {}),
    },
  }, ctx());
}

async function _resultEntryFor(conv, callId) {
  const entries = await projection.allEntries(conv);
  return entries.some((entry) => entry.kind === 'pi.tool-result'
    && entry.model && entry.model[0] && entry.model[0].toolCallId === callId);
}

async function shutdown() {
  for (const stream of shared.watchers.values()) {
    try { await stream.stop(); } catch { /* cierre */ }
  }
  shared.watchers.clear();
  shared.live.clear();
  if (shared.state) {
    const harness = shared.state.harness;
    shared.state = null;
    try { await harness.close(ctx()); } catch { /* cierre */ }
  }
}

module.exports = {
  open: _open,
  shutdown,
  handlers: {
    agent_sessions_list: sessionsList,
    agent_session_create: sessionCreate,
    agent_session_delete: sessionDelete,
    agent_messages_list: messagesList,
    agent_message_send: messageSend,
    agent_tools_list: toolsList,
    agent_turn_status: turnStatus,
    agent_turn_cancel: turnCancel,
    agent_approve: (p) => approve(p, true),
    agent_deny: (p) => approve(p, false),
  },
  _internal: {
    state: () => shared.state,
    _toolSpecs: shared.toolSpecs,
    _live: shared.live,
    _convToSession: shared.convToSession,
    _providerOverrides: shared.providerOverrides,
    _decisionWaiters: shared.decisionWaiters,
    _approvalsByCall: shared.approvalsByCall,
    INTERRUPTED_RESULT: shared.INTERRUPTED_RESULT,
    SYSTEM_PROMPT,
  },
};
