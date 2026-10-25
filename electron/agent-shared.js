'use strict';

const INTERRUPTED_RESULT = JSON.stringify({
  error: 'Acción interrumpida: el resultado puede ser incierto. Compruébalo antes de repetirla.',
});
const NOTICE_KIND = 'antares.notice';
const CONTEXT_MARKER = '[Contexto de Antares]';
const CHECK_MARKER = '[Comprobación de Antares]';

const shared = {
  deps: null,
  state: null,
  boot: null,
  live: new Map(),
  convToSession: new Map(),
  watchers: new Map(),
  toolSpecs: new Map(),
  approvalsByCall: new Map(),
  liveApprovals: new Set(),
  decisionWaiters: new Map(),
  rounds: new Map(),
  turns: new Map(),
  waitingInput: new Set(),
  wakers: new Set(),
  providers: new Map(),
  providerOverrides: new Map(),
  nativeTools: null,
  attachments: new Map(),
  dialog: null,
  notify: null,
  INTERRUPTED_RESULT,
  NOTICE_KIND,
  CONTEXT_MARKER,
  CHECK_MARKER,
};

// Los proveedores compatibles con OpenAI pueden repetir ids («call_0») entre turnos
// o dejarlos vacíos; la tarea de pi-durable identifica cada llamada de forma estable.
const TASK_SUFFIX = '@task:';

function dispatchCallId(callId, taskId) {
  return taskId ? `${callId || ''}${TASK_SUFFIX}${taskId}` : String(callId || '');
}

function providerCallId(dispatchId) {
  const value = String(dispatchId || '');
  const at = value.lastIndexOf(TASK_SUFFIX);
  return at === -1 ? value : value.slice(0, at);
}

function bridge(method, params) {
  return shared.deps.bridge(method, params);
}

function ctx() {
  return shared.deps.chord.BACKGROUND_CONTEXT;
}

function notFound(message) {
  const err = new Error(message);
  err.code = -32004;
  err.category = 'NOT_FOUND';
  return err;
}

function validation(message) {
  const err = new Error(message);
  err.code = -32602;
  err.category = 'VALIDATION_ERROR';
  return err;
}

function aborted() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

async function sessions() {
  const doc = await shared.state.harness.snapshot(shared.state.SessionsDoc, ctx());
  return (doc && doc.sessions) || {};
}

async function profiles() {
  const doc = await shared.state.harness.snapshot(shared.state.ProfilesDoc, ctx());
  return (doc && doc.profiles) || {};
}

async function commitSessions(change) {
  return shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.SessionsDoc);
    return change(doc.sessions);
  }, ctx());
}

async function requireSession(sessionId) {
  const session = (await sessions())[sessionId];
  if (!session || session.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
  return session;
}

function wakeWaiters() {
  for (const wake of [...shared.wakers]) {
    try { wake(); } catch { }
  }
}

async function conversation(sessionId) {
  const session = await requireSession(sessionId);
  const conv = await shared.state.harness.conversation(session.conversationId, ctx());
  if (!conv) throw notFound(`Conversación no encontrada: ${sessionId}`);
  shared.convToSession.set(session.conversationId, sessionId);
  return conv;
}

async function sessionForConversation(conversationId, api, context) {
  const cached = shared.convToSession.get(conversationId);
  if (cached) return cached;
  const doc = api
    ? await api.snapshot(shared.state.SessionsDoc, context)
    : await shared.state.harness.snapshot(shared.state.SessionsDoc, context);
  for (const session of Object.values((doc && doc.sessions) || {})) {
    shared.convToSession.set(session.conversationId, session.id);
  }
  return shared.convToSession.get(conversationId) || null;
}

module.exports = {
  shared,
  bridge,
  ctx,
  notFound,
  validation,
  aborted,
  sessions,
  profiles,
  commitSessions,
  requireSession,
  conversation,
  sessionForConversation,
  dispatchCallId,
  providerCallId,
  wakeWaiters,
};
