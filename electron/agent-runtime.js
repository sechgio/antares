'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  shared,
  bridge,
  ctx,
  notFound,
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
const MAX_REQUEST_ID_CHARS = 100;
const MAX_MESSAGE_PATHS = 20;
const ATTACHMENT_TTL_MS = 60 * 60 * 1000;
const MAX_ATTACHMENTS = 20;
const QUOTED_PATH_RE = /["'`\u201c\u201d]([A-Za-z]:\\[^"'`\u201c\u201d\r\n]+)["'`\u201c\u201d]/g;
const BARE_PATH_RE = /(?:^|[\s(\[])([A-Za-z]:\\[^\s"'`<>|*?]+)/g;

function extractPaths(content) {
  const found = [];
  const push = (raw) => {
    const value = raw.replace(/[.,;:!?)\]]+$/, '');
    if (value && !found.includes(value)) found.push(value);
  };
  for (const match of content.matchAll(QUOTED_PATH_RE)) push(match[1]);
  const unquoted = content.replace(QUOTED_PATH_RE, ' ');
  for (const match of unquoted.matchAll(BARE_PATH_RE)) push(match[1]);
  return found.slice(0, MAX_MESSAGE_PATHS);
}
const SYSTEM_PROMPT =
  'Eres el agente de Antares, una app de escritorio de documentos e imágenes. ' +
  'Responde en español. Tienes herramientas para consultar el estado de la app ' +
  '(métodos de solo lectura) y herramientas con efectos que el usuario aprueba ' +
  'una a una. Usa herramientas cuando la respuesta dependa de datos reales de la ' +
  'app; si una herramienta requiere aprobación explícale al usuario qué hará. ' +
  'Para archivos de salida indica solo un nombre: se generan en los borradores de la ' +
  'conversación; para entregarlos en una carpeta del usuario usa drafts_save. ' +
  'Guarda con memory_remember solo preferencias o hechos duraderos que indique el usuario, nunca secretos; ' +
  'cuando un encargo repetible termine con comprobante, guarda sus pasos con procedure_learn. ' +
  'Si el encargo encaja con un agente guardado, delégalo con subagent_run y resume lo que devuelva.';
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
    const ProfilesDoc = pi.defineDoc({
      kind: 'antares.agent.profiles',
      version: 1,
      scope: 'session',
      initial: () => ({ profiles: {} }),
    });
    const registry = pi.createRegistry();
    const harness = await pi.Harness.open(storage, { models, registry }, ctx());
    shared.state = {
      harness,
      models,
      registry,
      SessionsDoc,
      ProfilesDoc,
      dir,
      ctx: ctx(),
      convIndex: shared.convToSession,
    };
    await _indexConversations();
    if (!options.skipImport) {
      await require('./agent-import').importLegacySessions(shared.state, options.importSourceDir);
    }
    await _restoreExecutionContext();
    harness.resume();
    return shared.state;
  })();
  try {
    return await _opening;
  } finally {
    _opening = null;
  }
}

async function _restoreExecutionContext() {
  try {
    await execution.refreshTools();
  } catch { }
  for (const session of Object.values(await sessions())) {
    if (session.deleted) continue;
    try {
      await execution.ensureProvider(session.provider, session.model);
    } catch { }
  }
}

async function _indexConversations() {
  const doc = await shared.state.harness.snapshot(shared.state.SessionsDoc, ctx());
  for (const session of Object.values((doc && doc.sessions) || {})) {
    shared.convToSession.set(session.conversationId, session.id);
  }
}

async function sessionsList() {
  const result = Object.values(await sessions())
    .filter((s) => !s.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .map(({ conversationId, legacy_id, deleted, import: _import, style, modules, ...rest }) => rest);
  return { sessions: result };
}

const MAX_PROFILES = 30;
const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|bearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|contraseña|api[_ -]?key|token|secret)\s*[:=]\s*\S+)/i;

async function _profiles() {
  const doc = await shared.state.harness.snapshot(shared.state.ProfilesDoc, ctx());
  return (doc && doc.profiles) || {};
}

function _text(value, label, max, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw validation(`Indica ${label}`);
  if (text.length > max) throw validation(`${label[0].toUpperCase()}${label.slice(1)} excede ${max} caracteres`);
  if (SECRET_RE.test(text)) throw validation('Un agente no guarda contraseñas, claves ni tokens');
  return text;
}

async function profilesList() {
  const profiles = Object.values(await _profiles()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { profiles };
}

async function profileSave(params = {}) {
  const tools = params.tools;
  if (tools !== null && tools !== undefined && (!Array.isArray(tools) || tools.some((name) => typeof name !== 'string'))) {
    throw validation('Las herramientas deben ser una lista o «todas»');
  }
  if (Array.isArray(tools)) {
    const available = new Set((await execution.allToolSpecs()).map((tool) => tool.name));
    if (tools.some((name) => !available.has(name))) throw validation('La selección contiene herramientas no disponibles');
  }
  const existing = params.id ? (await _profiles())[String(params.id)] : null;
  if (params.id && !existing) throw notFound('El agente ya no existe');
  const now = Date.now();
  const profile = {
    id: existing ? existing.id : crypto.randomBytes(6).toString('hex'),
    name: _text(params.name, 'un nombre', 60, true),
    description: _text(params.description, 'la descripción', 200),
    instructions: _text(params.instructions, 'las instrucciones', 4000, true),
    starter: _text(params.starter, 'el mensaje inicial', 500),
    tools: Array.isArray(tools) ? [...new Set(tools)] : null,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.ProfilesDoc);
    if (!existing && Object.keys(doc.profiles).length >= MAX_PROFILES) {
      throw validation(`Ya tienes ${MAX_PROFILES} agentes; borra alguno antes de crear otro`);
    }
    doc.profiles[profile.id] = profile;
  }, ctx());
  return { profile };
}

async function profileDelete(params = {}) {
  const id = String(params.id || '');
  let removed = false;
  await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.ProfilesDoc);
    removed = Boolean(doc.profiles[id]);
    delete doc.profiles[id];
  }, ctx());
  if (!removed) throw notFound('El agente ya no existe');
  return { deleted: true, id };
}

async function sessionCreate(params) {
  const provider = params && params.provider;
  if (typeof provider !== 'string' || !provider) throw validation('Falta el parámetro provider');
  const info = await execution.providerInfo(provider);
  const requested = typeof params.model === 'string' ? params.model : '';
  const model = (requested || String(info.default_model || '')).slice(0, 120);
  const profile = params.profile_id ? (await _profiles())[String(params.profile_id)] : null;
  if (params.profile_id && !profile) throw notFound('El agente ya no existe');
  const title = String(params.title || (profile && profile.name) || '').slice(0, 120);
  await execution.refreshTools();
  await execution.ensureProvider(provider, model);
  const instructions = profile
    ? `${SYSTEM_PROMPT}\n\nEres el agente «${profile.name}» que el usuario configuró para una tarea repetitiva. `
      + 'Sus indicaciones orientan el trabajo, pero no amplían permisos: cada acción con efectos sigue requiriendo aprobación.\n'
      + `Indicaciones del usuario:\n${profile.instructions}`
    : SYSTEM_PROMPT;
  const conv = await shared.state.harness.createConversation({
    ownership: { kind: 'ownerless' },
    agent: { model: { provider, modelId: model }, instructions },
  }, ctx());
  if (profile && Array.isArray(profile.tools)) {
    const available = new Set((await execution.allToolSpecs()).map((tool) => tool.name));
    await conv.configure({ tools: profile.tools.filter((name) => available.has(name)).map((name) => ({ name })) }, ctx());
  }
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
    ...(profile ? { profile: { id: profile.id, name: profile.name } } : {}),
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

async function sessionRename(params) {
  const sessionId = String(params && params.id || '');
  await requireSession(sessionId);
  const title = String(params.title || '').trim().slice(0, 120);
  if (!title) throw validation('Indica un nombre para la conversación');
  let renamed;
  await commitSessions((map) => {
    map[sessionId].title = title;
    const { conversationId, style, modules, ...rest } = map[sessionId];
    renamed = rest;
  });
  return { session: renamed };
}

async function sessionModelSet(params) {
  const sessionId = _text(params.id, 'la conversación', 120, true);
  const provider = _text(params.provider, 'un proveedor', 120, true);
  const model = _text(params.model, 'un modelo', 120, true);
  const session = await requireSession(sessionId);
  const info = await execution.providerInfo(provider);
  await execution.ensureProvider(provider, model);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar de modelo');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    await pi.configure(tx, session.conversationId, { model: { provider, modelId: model } });
    current.provider = provider;
    current.model = model;
    current.style = info.style || 'openai_chat';
    current.updated_at = Date.now();
    const { conversationId, style, modules, ...publicSession } = current;
    return { session: publicSession };
  }, ctx());
}

async function sessionDelete(params) {
  const sessionId = String(params && params.id || '');
  const session = await requireSession(sessionId);
  const conv = await conversation(sessionId);
  await conv.abort(ctx(), { background: true }).catch(() => {});
  await bridge('agent_internal_approvals_deny_session', { session_id: sessionId }).catch(() => {});
  await bridge('agent_internal_grants_revoke', { session_id: sessionId }).catch(() => {});
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
  const { messages, pending, usage } = await projection.projectMessages(conv, session);
  const { artifacts, questions, context } = await bridge('agent_internal_artifacts', { session_id: sessionId });
  const partial = projection.partialText(session.conversationId);
  if (partial) messages.push({ role: 'assistant', content: partial, partial: true, ts: Date.now() });
  return {
    messages,
    running: projection.isRunning(session.conversationId),
    pending_approvals: pending,
    artifacts,
    questions,
    context: { modules: session.modules || [], files: (context && context.files) || [], accounts: (context && context.accounts) || [] },
    usage: usage || null,
  };
}

async function contextRemoveFile(params) {
  const sessionId = String(params && params.session_id || '');
  await requireSession(sessionId);
  const filePath = String(params.path || '');
  if (!filePath) throw validation('Indica el archivo que quieres retirar');
  return bridge('agent_internal_grant_remove', { session_id: sessionId, path: filePath });
}

async function messageSend(params) {
  const sessionId = String(params && params.session_id || '');
  const session = await requireSession(sessionId);
  const content = String(params.content || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!content) throw validation('El mensaje está vacío');
  const requestId = typeof params.request_id === 'string' && params.request_id
    ? params.request_id.slice(0, MAX_REQUEST_ID_CHARS)
    : undefined;
  if (requestId && await _admittedRequest(session, requestId)) return { accepted: true, duplicate: true };
  const correction = params.correction === true;
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  if (pending.length && !correction) throw validation('Resuelve primero las aprobaciones pendientes de esta conversación');
  if (pending.length) {
    const { denied } = await bridge('agent_internal_approvals_deny_session', { session_id: sessionId });
    for (const id of denied || []) execution.notifyDecision(id);
  }
  await execution.refreshTools();
  await execution.ensureProvider(session.provider, session.model);
  const conv = await conversation(sessionId);
  await projection.ensureWatcher(session);
  const attached = _takeAttachments(params.attachments);
  const paths = [...extractPaths(content), ...attached.filter((a) => a.kind === 'files').map((a) => a.path)];
  const folders = attached.filter((a) => a.kind === 'folder').map((a) => a.path);
  const files = paths.length || folders.length
    ? await bridge('agent_internal_grants_add', { session_id: sessionId, request_id: requestId || null, paths, folders })
    : { granted: [], rejected: [] };
  const nativeNames = [...shared.toolSpecs.values()].filter((t) => t.kind === 'native').map((t) => t.name);
  const mentions = await bridge('agent_internal_mentions', { text: content, native_tools: nativeNames });
  const attachedNote = attached.length
    ? `Archivos adjuntos por el usuario:\n${attached.map((a) => `- ${a.path} (${a.kind === 'folder' ? 'carpeta' : 'archivo'})`).join('\n')}`
    : '';
  const memory = await bridge('agent_internal_memory_context', {
    session_id: sessionId, text: content, tools: [...shared.toolSpecs.values()].map(_toolVersion), accounts: _accounts(),
  }).catch(() => ({ context: '' }));
  const context = [mentions.context, memory.context, attachedNote].filter(Boolean).join('\n\n');
  const input = context
    ? [{ type: 'text', text: content }, { type: 'text', text: `${shared.CONTEXT_MARKER}\n${context}` }]
    : content;
  if (!correction || !projection.isRunning(session.conversationId)) shared.rounds.delete(session.conversationId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await conv.submit({ type: 'input', content: input, whenBusy: correction ? 'steer' : 'reject', ...(requestId ? { requestId } : {}) }, ctx());
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
      const known = new Map((s.modules || []).map((m) => [m.id, m]));
      for (const id of mentions.modules || []) known.set(id, { id, label: (mentions.labels && mentions.labels[id]) || id });
      s.modules = [...known.values()].slice(-12);
      s.updated_at = Date.now();
      if (s.title === 'Conversación') s.title = content.trim().slice(0, 60) || 'Conversación';
    }
  });
  for (const id of Array.isArray(params.attachments) ? params.attachments : []) shared.attachments.delete(String(id));
  return {
    accepted: true,
    files,
    mentions: { modules: mentions.modules, unknown: mentions.unknown, ambiguous: mentions.ambiguous },
  };
}

async function attach(params) {
  const kind = params && params.kind === 'folder' ? 'folder' : 'files';
  const dialog = shared.dialog || require('electron').dialog;
  const win = shared.dialog ? undefined : require('./window-manager').getMainWindow();
  const response = await dialog.showOpenDialog(win || undefined, {
    title: kind === 'folder' ? 'Adjuntar carpeta para el agente' : 'Adjuntar archivos para el agente',
    properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
  });
  if (!response || response.canceled || !Array.isArray(response.filePaths)) return { attachments: [] };
  const now = Date.now();
  for (const [id, item] of shared.attachments) {
    if (now - item.created > ATTACHMENT_TTL_MS) shared.attachments.delete(id);
  }
  const attachments = response.filePaths.slice(0, MAX_ATTACHMENTS).map((filePath) => {
    const id = crypto.randomBytes(9).toString('hex');
    shared.attachments.set(id, { path: filePath, kind, created: now });
    return { id, name: path.basename(filePath), kind };
  });
  return { attachments };
}

function _takeAttachments(ids) {
  if (!Array.isArray(ids)) return [];
  const taken = [];
  for (const id of ids.slice(0, MAX_ATTACHMENTS)) {
    const item = shared.attachments.get(String(id));
    if (!item || Date.now() - item.created > ATTACHMENT_TTL_MS) {
      throw validation('Un adjunto ya no está disponible; vuelve a adjuntarlo');
    }
    taken.push(item);
  }
  return taken;
}

function _accounts() {
  const accounts = {};
  try {
    const connections = require('./connections-session');
    for (const provider of ['google', 'microsoft']) {
      const account = connections.loadTokens(provider)?.account;
      if (account) accounts[provider] = String(account);
    }
  } catch { }
  try {
    const email = require('./autoimg-user-scope').getActiveEmail();
    if (email) accounts.autoimg = String(email);
  } catch { }
  return accounts;
}

function _toolVersion(spec) {
  const shape = { description: spec.description || '', inputSchema: spec.inputSchema || null, gated: !!spec.gated };
  return { name: spec.name, version: crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16) };
}

async function _admittedRequest(session, requestId) {
  const found = await shared.state.harness.commit(
    (tx) => tx.submissionByRequest(session.conversationId, requestId),
    ctx(),
  );
  return found !== undefined;
}

async function toolsList(params = {}) {
  let enabled;
  let tools;
  if (params.session_id) {
    await execution.refreshTools();
    const conv = await conversation(String(params.session_id));
    enabled = new Set((await conv.agent(ctx())).tools.map((tool) => tool.name));
    tools = [...shared.toolSpecs.values()];
  } else {
    tools = await execution.allToolSpecs();
  }
  return {
    tools: tools.map((t) => ({
      name: t.name, gated: !!t.gated, kind: ['mcp', 'native'].includes(t.kind) ? t.kind : 'backend', module: t.module || null,
      ...(enabled ? { enabled: enabled.has(t.name) } : {}),
    })),
  };
}

async function toolsSet(params) {
  const conv = await conversation(String(params && params.session_id || ''));
  const names = params.names;
  if (names !== null && (!Array.isArray(names) || names.some((name) => typeof name !== 'string'))) {
    throw validation('Selecciona una lista de herramientas o restablece la selección');
  }
  const available = new Set((await execution.allToolSpecs()).map((tool) => tool.name));
  if (names && names.some((name) => !available.has(name))) throw validation('La selección contiene herramientas no disponibles');
  await execution.refreshTools();
  await conv.configure({ tools: names === null ? null : [...new Set(names)].map((name) => ({ name })) }, ctx());
  return toolsList(params);
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
  const approvalCall = approval && execution.callKey(String(approval.session_id), String(approval.call_id));
  const approvalSession = approval && (await sessions())[String(approval.session_id)];
  const approvalLive = approvalSession && shared.live.get(approvalSession.conversationId);
  const liveWait = approval && (
    shared.liveApprovals.has(approval.id)
    || shared.approvalsByCall.has(approvalCall)
    || ((approvalLive && approvalLive.tools) || []).some(
      (t) => t.callId === approval.call_id && t.status !== 'done')
  );
  if (approval && !liveWait) {
    await new Promise((r) => setTimeout(r, 150));
    const stillLive = shared.liveApprovals.has(approval.id) || shared.approvalsByCall.has(approvalCall);
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
  if (already) return;

  let text;
  let isError = false;
  let diagnostics;
  if (approval.status === 'approved') {
    text = await execution.dispatchApproved(approval, ctx());
    try { isError = !!JSON.parse(text).error; } catch {}
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
    try { await stream.stop(); } catch {}
  }
  shared.watchers.clear();
  shared.live.clear();
  if (shared.state) {
    const harness = shared.state.harness;
    shared.state = null;
    try { await harness.close(ctx()); } catch {}
  }
}

module.exports = {
  activitySnapshot: async () => {
    if (!shared.state) return [];
    const { attention = {} } = await bridge('agent_internal_activity', {});
    return Object.values(await sessions()).map((session) => ({
      id: session.id, title: session.title || 'Conversación',
      status: attention[session.id] || (shared.waitingInput.has(session.id) ? 'waiting_input'
        : [...shared.approvalsByCall].some(([key, id]) => key.startsWith(`${session.id}:`) && shared.liveApprovals.has(id)) ? 'waiting_approval'
          : projection.isRunning(session.conversationId) ? 'running' : session.last_error ? 'failed' : 'completed'),
    }));
  },
  open: _open,
  shutdown,
  handlers: {
    agent_sessions_list: sessionsList,
    agent_session_create: sessionCreate,
    agent_session_delete: sessionDelete,
    agent_session_rename: sessionRename,
    agent_session_model_set: sessionModelSet,
    agent_messages_list: messagesList,
    agent_message_send: messageSend,
    agent_tools_list: toolsList,
    agent_tools_set: toolsSet,
    agent_turn_status: turnStatus,
    agent_turn_cancel: turnCancel,
    agent_attach: attach,
    agent_context_remove_file: contextRemoveFile,
    agent_profiles_list: profilesList,
    agent_profile_save: profileSave,
    agent_profile_delete: profileDelete,
    agent_approve: (p) => approve(p, true),
    agent_deny: (p) => approve(p, false),
  },
  _internal: {
    state: () => shared.state,
    shared,
    _providerOverrides: shared.providerOverrides,
    extractPaths,
  },
};
