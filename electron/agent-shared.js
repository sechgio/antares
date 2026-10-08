'use strict';

// Estado efímero compartido del runtime del agente (nada de esto llega al
// renderer) y acceso al documento durable de sesiones. Lo pobla
// agent-runtime.js en open() y lo consumen agent-execution.js y
// agent-projection.js.

const INTERRUPTED_RESULT = JSON.stringify({
  error: 'Acción interrumpida: el resultado puede ser incierto. Compruébalo antes de repetirla.',
});
const NOTICE_KIND = 'antares.notice';

const shared = {
  deps: null, // {pi, chord, aiOpenai, aiAnthropic, bridge}
  state: null, // {harness, models, registry, SessionsDoc, dir, ctx, convIndex}
  live: new Map(), // conversationId -> último snapshot de watchEvents
  convToSession: new Map(), // conversationId -> sessionId público
  watchers: new Map(), // conversationId -> AgentEventStream
  toolSpecs: new Map(), // name -> {gated, kind}
  approvalsByCall: new Map(), // callId -> approvalId
  liveApprovals: new Set(), // approvalId con espera beforeTool activa
  decisionWaiters: new Map(), // approvalId -> Set<resolve>
  rounds: new Map(), // conversationId -> rondas de herramientas del run
  providers: new Map(), // providerId -> {info, modelIds:Set}
  providerOverrides: new Map(), // providerId -> Provider (tests)
  INTERRUPTED_RESULT,
  NOTICE_KIND,
};

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
  commitSessions,
  requireSession,
  conversation,
  sessionForConversation,
};
