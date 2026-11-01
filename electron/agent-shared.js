'use strict';

const INTERRUPTED_RESULT = JSON.stringify({
  error: 'Acción interrumpida: el resultado puede ser incierto. Compruébalo antes de repetirla.',
});
const NOTICE_KIND = 'antares.notice';
const CONTEXT_MARKER = '[Contexto de Antares]';
const ATTACHMENTS_MARKER = '[Adjuntos del mensaje de Antares]';
const CHECK_MARKER = '[Comprobación de Antares]';
const DELEGATION_GUIDE = 'Cómo elegir la delegación: agent_delegate abre una conversación aparte con historial, '
  + 'seguimiento, continuación y salas; sirve para encargos que pueden durar o varios agentes a la vez, y solo lee. '
  + 'subagent_run devuelve el resultado en este mismo turno, agrupa varios encargos, admite output_schema y es la '
  + 'única vía para worker, con cada efecto aprobado aquí. No uses las dos para el mismo encargo.';

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
  turnRuns: new Map(),
  skillIndexes: new Map(),
  unattendedApps: new Map(),
  waitingInput: new Set(),
  wakers: new Set(),
  providers: new Map(),
  providerOverrides: new Map(),
  nativeTools: null,
  globalRules: {},
  attachments: new Map(),
  dialog: null,
  notify: null,
  INTERRUPTED_RESULT,
  NOTICE_KIND,
  CONTEXT_MARKER,
  ATTACHMENTS_MARKER,
  CHECK_MARKER,
  DELEGATION_GUIDE,
};

const PLAN_CONTRACT = require('../shared/agent-plan.json');
const PLAN_STATUSES = new Set(PLAN_CONTRACT.statuses);
const MAX_PLAN_STEPS = Number(PLAN_CONTRACT.max_steps) || 20;
const MAX_PLAN_TITLE_CHARS = Number(PLAN_CONTRACT.max_title_chars) || 160;
const MAX_PLAN_EVIDENCE_CHARS = Number(PLAN_CONTRACT.max_evidence_chars) || 300;
const MAX_PLAN_ID_CHARS = Number(PLAN_CONTRACT.max_id_chars) || 64;
const MAX_PLAN_STEP_DEPENDENCIES = Number(PLAN_CONTRACT.max_step_dependencies) || 20;
const planWrites = new Map();
const deletedPlans = new Set();

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

function dispatchTaskId(dispatchId) {
  const value = String(dispatchId || '');
  const at = value.lastIndexOf(TASK_SUFFIX);
  return at === -1 ? '' : value.slice(at + TASK_SUFFIX.length);
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

function planErrorDetail(err) {
  const raw = String((err && (err.message || err.name || err.code)) || err || 'unknown');
  try {
    return require('./agent-execution').sanitizeProviderError(raw).slice(0, 300);
  } catch {
    return raw.slice(0, 120);
  }
}

function planFromParams(params) {
  if (!params || !Array.isArray(params.steps) || !params.steps.length) return null;
  const steps = [];
  for (const step of params.steps.slice(0, MAX_PLAN_STEPS)) {
    const title = String((step && step.title) || '').trim();
    if (!title) continue;
    const status = PLAN_STATUSES.has(step && step.status) ? step.status : 'pending';
    const evidence = String((step && step.evidence) || '').trim();
    const id = String((step && step.id) || '').slice(0, MAX_PLAN_ID_CHARS);
    const dependencies = Array.isArray(step && step.dependencies)
      ? step.dependencies.filter((dependency) => dependency != null && String(dependency).trim())
        .map(String).slice(0, MAX_PLAN_STEP_DEPENDENCIES)
      : [];
    steps.push({
      ...(id ? { id } : {}),
      title: title.slice(0, MAX_PLAN_TITLE_CHARS),
      status,
      ...(evidence ? { evidence: evidence.slice(0, MAX_PLAN_EVIDENCE_CHARS) } : {}),
      ...(dependencies.length ? { dependencies } : {}),
    });
  }
  if (!steps.length) return null;
  return { goal: String(params.goal || '').trim(), steps };
}

async function savePlan(sessionId, plan) {
  const state = shared.state;
  const normalized = planFromParams(plan);
  if (!state?.PlanDoc || !sessionId || !normalized) return false;
  if (deletedPlans.has(sessionId)) return false;
  const write = async () => {
    if (deletedPlans.has(sessionId)) return false;
    try {
      await state.harness.commit(async (tx) => {
        const doc = await tx.doc(state.PlanDoc);
        doc.plans[sessionId] = { ...normalized, updated_at: Date.now() };
      }, ctx());
      return true;
    } catch (err) {
      console.warn('[agent] plan save failed:', planErrorDetail(err));
      return false;
    }
  };
  const previous = planWrites.get(sessionId) || Promise.resolve();
  const queued = previous.then(write, write);
  planWrites.set(sessionId, queued);
  const cleanup = () => {
    if (planWrites.get(sessionId) === queued) planWrites.delete(sessionId);
  };
  queued.then(cleanup, cleanup);
  return queued;
}

async function readPlan(sessionId) {
  const state = shared.state;
  if (!state?.PlanDoc || !sessionId) return null;
  try {
    const doc = await state.harness.snapshot(state.PlanDoc, ctx());
    return doc?.plans?.[sessionId] || null;
  } catch (err) {
    console.warn('[agent] plan read failed:', planErrorDetail(err));
    return null;
  }
}

async function deleteSessionAndPlan(sessionId) {
  // Marca antes de drenar: un task_plan en vuelo no puede recrear el plan tras el borrado.
  deletedPlans.add(sessionId);
  try {
    const pending = planWrites.get(sessionId);
    if (pending) await pending;
    const state = shared.state;
    if (!state?.SessionsDoc) throw new Error('El agente no está abierto');
    return await state.harness.commit(async (tx) => {
      const sessionsDoc = await tx.doc(state.SessionsDoc);
      delete sessionsDoc.sessions[sessionId];
      if (state.PlanDoc) {
        const plansDoc = await tx.doc(state.PlanDoc);
        delete plansDoc.plans[sessionId];
      }
    }, ctx());
  } catch (err) {
    deletedPlans.delete(sessionId);
    throw err;
  }
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
  planFromParams,
  savePlan,
  readPlan,
  deleteSessionAndPlan,
  requireSession,
  conversation,
  sessionForConversation,
  dispatchCallId,
  providerCallId,
  dispatchTaskId,
  wakeWaiters,
};
