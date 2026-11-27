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
  profiles: _profiles,
  commitSessions,
  planFromParams,
  readPlan,
  continuationContext,
  deleteSessionAndPlan,
  requireSession,
  conversation,
  providerCallId,
} = require('./agent-shared');
const execution = require('./agent-execution');
const projection = require('./agent-projection');
const { validateRules } = require('./agent-channels');
const compactionPolicy = require('./agent-compaction');
const { loadAgentProfile, resolvePortableProfile } = require('./agent-profiles');
const {
  SKILLS_GUIDE,
  agentInstructions,
  legacyNotes,
  migrateInstructions,
  withMemorySnapshot,
} = require('./agent-prompts');

const MAX_MESSAGE_CHARS = 12_000;
const MAX_REQUEST_ID_CHARS = 100;
const ATTACHMENT_TTL_MS = 60 * 60 * 1000;
const MAX_ATTACHMENTS = 20;
const MAX_PASTED_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_INDEXED_SKILLS = 40;
const PROFILE_ONBOARDING_PROMPT =
  'El usuario creó este agente sin completar su presentación persistente. ' +
  'Antares envía este contexto para iniciarla; no es un mensaje visible del usuario. ' +
  'En tu primera respuesta saluda con naturalidad, preséntate con el nombre de este agente y explica en una frase ' +
  'que quieres saber para qué le gustaría usarte. ' +
  'Si ask_user está disponible, llámala con una sola pregunta: id «proposito», ' +
  'prompt «¿Para qué te gustaría usar este agente principalmente?» y options ' +
  '«Programar y desplegar proyectos», «Organizar archivos y documentos», «Investigar y resumir información», ' +
  '«Automatizar tareas repetitivas» y «Otra cosa». Si ask_user no está disponible, formula la misma pregunta con esas opciones. ' +
  'No uses ninguna herramienta durante esta presentación salvo ask_user y profile_onboarding_save. ' +
  'Cuando el usuario responda, haz como mucho dos preguntas breves para acordar nombre, rol, tono y avatar opcional del agente, ' +
  'y sus preferencias estables (idioma, forma de trabajo y zona horaria). No pidas ni guardes secretos. ' +
  'Antes de guardar, muestra el contenido exacto y breve que escribirás en IDENTITY.md y USER.md y pide confirmación explícita. ' +
  'Solo después de esa confirmación llama profile_onboarding_save con confirmed=true, identity con name/role/tone/avatar opcional ' +
  'y user con las preferencias estables (máximo 4000 caracteres). Esa herramienta valida y persiste ambos archivos; no uses fs_write ni memoria para esto. ' +
  'Si el usuario no confirma, no guardes nada. Cuando termine, continúa ayudándole y no repitas esta presentación salvo que pida «rehacer presentación».';
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
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
  if (_opening) return _opening;
  if (shared.state) return shared.state;
  _opening = (async () => {
    const { pi } = shared.deps;
    const dir = options.dir || _agentDir();
    fs.mkdirSync(dir, { recursive: true });
    const storage =
      options.storage ||
      (await (
        await import('@earendil-works/pi-durable/storage/sqlite/node')
      ).openNodeSqliteStorage(options.dbPath || _dbPath()));
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
    const TasksDoc = pi.defineDoc({
      kind: 'antares.agent.scheduled-tasks',
      version: 1,
      scope: 'session',
      initial: () => ({ tasks: {}, queues: {}, next_queue_seq: 1 }),
    });
    const PolicyDoc = pi.defineDoc({
      kind: 'antares.agent.policy',
      version: 1,
      scope: 'session',
      initial: () => ({ rules: {}, audit: [] }),
    });
    const WaitsDoc = pi.defineDoc({
      kind: 'antares.agent.waits',
      version: 1,
      scope: 'session',
      initial: () => ({ waits: {} }),
    });
    const BudgetDoc = pi.defineDoc({
      kind: 'antares.agent.budget',
      version: 1,
      scope: 'conversation',
      initial: () => ({ rounds: 0 }),
    });
    const RoomsDoc = pi.defineDoc({
      kind: 'antares.agent.rooms',
      version: 1,
      scope: 'session',
      initial: () => ({ rooms: {} }),
    });
    const PlanDoc = pi.defineDoc({
      kind: 'antares.agent.plans',
      version: 1,
      scope: 'session',
      initial: () => ({ plans: {} }),
    });
    const registry = pi.createRegistry();
    const settings = {
      ...(options.settings || {}),
      stream: { cacheRetention: 'long', ...(options.settings && options.settings.stream) },
      compaction:
        options.compaction || (options.settings && options.settings.compaction) || compactionPolicy.loadPolicy(dir),
      ...(options.retry ? { retry: options.retry } : {}),
    };
    const harness = await pi.Harness.open(storage, { models, registry, settings }, ctx());
    shared.boot = crypto.randomUUID();
    shared.state = {
      harness,
      models,
      registry,
      SessionsDoc,
      ProfilesDoc,
      TasksDoc,
      PolicyDoc,
      WaitsDoc,
      BudgetDoc,
      RoomsDoc,
      PlanDoc,
      compaction: settings.compaction,
      dir,
      ctx: ctx(),
      convIndex: shared.convToSession,
      portableProfiles: new Map(),
    };
    const policy = await harness.snapshot(PolicyDoc, ctx());
    shared.globalRules = { ...(policy && policy.rules ? policy.rules : {}) };
    shared.globalScopedRules = Array.isArray(policy && policy.scoped_rules) ? policy.scoped_rules.map((rule) => ({ ...rule })) : [];
    await _indexConversations();
    await _restoreExecutionContext();
    if (!options.skipImport) {
      await require('./agent-import').importLegacySessions(shared.state, options.importSourceDir);
    }
    harness.resume();
    require('./agent-tasks').start();
    return shared.state;
  })();
  try {
    return await _opening;
  } catch (error) {
    await shutdown();
    throw error;
  } finally {
    _opening = null;
  }
}

async function _restoreExecutionContext() {
  await execution.refreshTools();
  const { harness } = shared.state;
  const { pi } = shared.deps;
  for (const session of Object.values(await sessions())) {
    if (session.deleted) continue;
    if (session.profile?.portable) {
      shared.state.portableProfiles.set(session.conversationId, { kind: 'unloaded', slug: session.profile.id });
    }
    const live = await harness.snapshot(pi.LiveDoc, session.conversationId, ctx());
    const inbox = await harness.snapshot(pi.InboxDoc, session.conversationId, ctx());
    const pending = !!live?.run || !!inbox?.items.length;
    try {
      await execution.ensureProvider(session.provider, session.model);
    } catch (error) {
      if (pending) throw error;
    }
    if (pending) await projection.ensureWatcher(session);
  }
}

async function _indexConversations() {
  const doc = await shared.state.harness.snapshot(shared.state.SessionsDoc, ctx());
  for (const session of Object.values((doc && doc.sessions) || {})) {
    shared.convToSession.set(session.conversationId, session.id);
  }
}

const LEGACY_REASONING = ['minimal', 'low', 'medium', 'high'];

function toPublicSession(current) {
  const { conversationId, style, modules, memory_checkpoint, ...rest } = current;
  if (rest.approval_rules && typeof rest.approval_rules === 'object') {
    rest.approval_rules = { ...rest.approval_rules };
  }
  rest.reasoning_levels = rest.reasoning_levels
    ? [...rest.reasoning_levels]
    : execution.supportsReasoning(style, rest.model)
      ? LEGACY_REASONING
      : [];
  return JSON.parse(JSON.stringify(rest));
}

async function _syncListedReasoning() {
  const ready = new Map();
  for (const session of Object.values(await sessions())) {
    if (session.deleted) continue;
    const key = JSON.stringify([session.provider, session.model]);
    if (!ready.has(key)) {
      ready.set(
        key,
        await execution.ensureProvider(session.provider, session.model).then(
          () => true,
          () => false,
        ),
      );
    }
    if (ready.get(key)) await _syncReasoning(session).catch(() => {});
  }
}

async function sessionsList() {
  await _syncListedReasoning();
  const result = Object.values(await sessions())
    .filter((s) => !s.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .map(({ conversationId, legacy_id, deleted, import: _import, style, modules, ...rest }) => {
      if (rest.approval_rules && typeof rest.approval_rules === 'object') {
        rest.approval_rules = { ...rest.approval_rules };
      }
      return {
        ...rest,
        reasoning_levels:
          rest.reasoning_levels ?? (execution.supportsReasoning(style, rest.model) ? LEGACY_REASONING : []),
      };
    });
  return { sessions: result };
}

const MAX_PROFILES = 30;
const PROFILE_ROLES = new Set(['explorer', 'reviewer', 'worker']);
const MEMORY_SCOPES = new Set(['shared-read', 'own', 'none']);
const BROWSER_MODES = new Set(['auto', 'ephemeral', 'persistent']);
const MIN_DAILY_TOKENS = 1000;
const MAX_DAILY_TOKENS = 100_000_000;
const SECRET_RE =
  /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|bearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|contraseña|api[_ -]?key|token|secret)\s*[:=]\s*\S+)/i;

function _text(value, label, max, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw validation(`Indica ${label}`);
  if (text.length > max) throw validation(`${label[0].toUpperCase()}${label.slice(1)} excede ${max} caracteres`);
  if (SECRET_RE.test(text)) throw validation('Un agente no guarda contraseñas, claves ni tokens');
  return text;
}

// SOUL/USER opcionales: si el guardado no los envía se conservan los anteriores; vacíos no se persisten.
function identityFields(params, existing) {
  const identity = _text(params.identity ?? existing?.identity, 'la identidad del agente (IDENTITY)', 4000);
  const soul = _text(params.soul ?? existing?.soul, 'la personalidad (SOUL)', 4000);
  const user = _text(params.user ?? existing?.user, 'las preferencias del usuario (USER)', 4000);
  return { ...(identity ? { identity } : {}), ...(soul ? { soul } : {}), ...(user ? { user } : {}) };
}

async function profilesList() {
  const profiles = Object.values(await _profiles()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { profiles };
}

async function profileSave(params = {}) {
  if (
    params.color !== undefined &&
    (typeof params.color !== 'string' || !/^(?:#[0-9a-fA-F]{6})?(?![\s\S])/.test(params.color))
  ) {
    throw validation('El color debe ser hexadecimal o automático');
  }
  const tools = params.tools;
  if (
    tools !== null &&
    tools !== undefined &&
    (!Array.isArray(tools) || tools.some((name) => typeof name !== 'string'))
  ) {
    throw validation('Las herramientas deben ser una lista o «todas»');
  }
  const existing = params.id ? (await _profiles())[String(params.id)] : null;
  if (params.id && !existing) throw notFound('El agente ya no existe');
  const deny = params.tools_deny === undefined ? existing?.tools_deny || [] : params.tools_deny;
  if (!Array.isArray(deny) || deny.some((name) => typeof name !== 'string')) {
    throw validation('Las herramientas bloqueadas deben ser una lista');
  }
  if (Array.isArray(tools) || deny.length) {
    const available = new Set((await execution.allToolSpecs()).map((tool) => tool.name));
    if ([...(tools || []), ...deny].some((name) => !available.has(name)))
      throw validation('La selección contiene herramientas no disponibles');
  }
  const role = params.role === undefined ? existing?.role || 'explorer' : String(params.role);
  if (!PROFILE_ROLES.has(role)) throw validation('Rol de agente no válido: usa explorer, reviewer o worker');
  const memoryScope =
    params.memory_scope === undefined ? existing?.memory_scope || 'shared-read' : String(params.memory_scope);
  if (!MEMORY_SCOPES.has(memoryScope)) throw validation('Alcance de memoria no válido: usa shared-read, own o none');
  const browserMode =
    params.browser_mode === undefined ? existing?.browser_mode || 'auto' : String(params.browser_mode);
  if (!BROWSER_MODES.has(browserMode))
    throw validation('Modo del navegador no válido: usa auto, ephemeral o persistent');
  const dailyTokens = params.daily_tokens === undefined ? (existing?.daily_tokens ?? null) : params.daily_tokens;
  if (
    dailyTokens !== null &&
    (!Number.isInteger(dailyTokens) || dailyTokens < MIN_DAILY_TOKENS || dailyTokens > MAX_DAILY_TOKENS)
  ) {
    throw validation(
      `El presupuesto diario debe estar entre ${MIN_DAILY_TOKENS} y ${MAX_DAILY_TOKENS} tokens, o vacío para no limitarlo`,
    );
  }
  const dreaming = params.dreaming === undefined ? existing?.dreaming === true : params.dreaming;
  if (typeof dreaming !== 'boolean') throw validation('Indica si el agente consolida su memoria cada noche');
  const recencyHalfLife =
    params.recency_half_life_days === undefined ? (existing?.recency_half_life_days ?? 14) : params.recency_half_life_days;
  if (!Number.isInteger(recencyHalfLife) || recencyHalfLife < 1 || recencyHalfLife > 365) {
    throw validation('La vida media de recencia debe ser un entero entre 1 y 365 días');
  }
  const rawModel = params.model === undefined ? (existing?.model ?? null) : params.model;
  let agentModel = null;
  if (rawModel !== null) {
    if (typeof rawModel !== 'object' || Array.isArray(rawModel)) {
      throw validation('El modelo del agente debe indicar proveedor y modelo');
    }
    const provider = _text(rawModel.provider, 'un proveedor', 120, true);
    const modelId = _text(rawModel.model, 'un modelo', 120, true);
    await execution.ensureProvider(provider, modelId);
    agentModel = { provider, model: modelId };
  }
  const now = Date.now();
  const profile = {
    id: existing ? existing.id : crypto.randomBytes(6).toString('hex'),
    name: _text(params.name, 'un nombre', 60, true),
    ...((params.color ?? existing?.color) ? { color: params.color ?? existing.color } : {}),
    description: _text(params.description, 'la descripción', 200),
    role,
    instructions: _text(params.instructions, 'las instrucciones', 4000),
    starter: _text(params.starter, 'el mensaje inicial', 500),
    tools: Array.isArray(tools) ? [...new Set(tools)] : null,
    ...(deny.length ? { tools_deny: [...new Set(deny)] } : {}),
    ...(memoryScope !== 'shared-read' ? { memory_scope: memoryScope } : {}),
    ...(browserMode !== 'auto' ? { browser_mode: browserMode } : {}),
    ...(dailyTokens !== null ? { daily_tokens: dailyTokens } : {}),
    ...(dreaming ? { dreaming: true } : {}),
    ...(recencyHalfLife !== 14 ? { recency_half_life_days: recencyHalfLife } : {}),
    ...(agentModel ? { model: agentModel } : {}),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.ProfilesDoc);
    const current = doc.profiles[profile.id];
    if (existing && !current) throw notFound('El agente ya no existe');
    if (!existing && Object.keys(doc.profiles).length >= MAX_PROFILES) {
      throw validation(`Ya tienes ${MAX_PROFILES} agentes; borra alguno antes de crear otro`);
    }
    Object.assign(profile, identityFields(params, current));
    if (current?.onboarded_at) profile.onboarded_at = current.onboarded_at;
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
    if (doc.usage) delete doc.usage[id];
    if (doc.dreaming) delete doc.dreaming[id];
    if (removed) await require('./agent-tasks').cancelOrphanedRoutines(shared.state, tx);
  }, ctx());
  if (!removed) throw notFound('El agente ya no existe');
  require('./agent-file-watcher').syncWatchers().catch(() => {});
  return { deleted: true, id };
}

async function templateExport(params = {}) {
  const id = String(params.id || '');
  const profile = (await _profiles())[id];
  if (!profile) throw notFound('El agente ya no existe');
  return {
    template: require('./agent-profile-templates').exportTemplate(profile, { includeUser: params.include_user === true }),
  };
}

async function templateImport(params = {}) {
  const templates = require('./agent-profile-templates');
  let validated;
  try {
    validated = templates.validateTemplate(params.template);
  } catch (error) {
    throw validation(error.message);
  }
  return profileSave(validated);
}

async function sessionCreate(params) {
  const provider = params && params.provider;
  if (typeof provider !== 'string' || !provider) throw validation('Falta el parámetro provider');
  const info = await execution.providerInfo(provider);
  const requested = typeof params.model === 'string' ? params.model : '';
  const savedProfile = params.profile_id ? (await _profiles())[String(params.profile_id)] : null;
  const portableProfile = params.profile_id && !savedProfile ? loadAgentProfile(String(params.profile_id)) : null;
  const profile = savedProfile || (portableProfile && { ...portableProfile, id: portableProfile.slug });
  const model = (requested || portableProfile?.model || String(info.default_model || '')).slice(0, 120);
  const title = String(params.title || (profile && profile.name) || '').slice(0, 120);
  await execution.refreshTools();
  await execution.ensureProvider(provider, model);
  const levels = await execution.reasoningLevels(provider, model);
  const needsOnboarding = Boolean(
    savedProfile
      ? !savedProfile.instructions && !(savedProfile.onboarded_at && savedProfile.identity && savedProfile.user)
      : portableProfile && !portableProfile.onboarded_at,
  );
  const instructions = agentInstructions(profile);
  const conv = await shared.state.harness.createConversation(
    {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider, modelId: model }, thinkingLevel: execution.thinkingLevelFor(levels), instructions },
    },
    ctx(),
  );
  const initialTools = execution.profileInitialTools(profile, [...shared.toolSpecs.values()]);
  if (initialTools) {
    const tools = needsOnboarding ? [...new Set([...initialTools, 'profile_onboarding_save'])] : initialTools;
    await conv.configure({ tools: tools.map((name) => ({ name })) }, ctx());
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
    reasoning_levels: levels,
    ...(profile
      ? { profile: { id: profile.id, name: profile.name, ...(portableProfile ? { portable: true } : {}) } }
      : {}),
  };
  await commitSessions((map) => {
    map[session.id] = session;
  });
  if (portableProfile) shared.state.portableProfiles.set(conv.id, { kind: 'loaded', profile: portableProfile });
  shared.convToSession.set(conv.id, session.id);
  if (needsOnboarding) {
    try {
      await projection.ensureWatcher(session);
      await conv.submit(
        {
          type: 'input',
          content: [{ type: 'text', text: `${shared.CONTEXT_MARKER}\n${PROFILE_ONBOARDING_PROMPT}` }],
          requestId: `profile-onboarding:${session.id}`,
          whenBusy: 'followUp',
        },
        ctx(),
      );
    } catch (error) {
      console.error(
        `[agent] no se pudo iniciar el onboarding: ${execution.sanitizeProviderError(String(error?.message || error))}`,
      );
    }
  }
  return { session: toPublicSession(session) };
}

async function sessionRename(params) {
  const sessionId = String((params && params.id) || '');
  await requireSession(sessionId);
  const title = String(params.title || '')
    .trim()
    .slice(0, 120);
  if (!title) throw validation('Indica un nombre para la conversación');
  let renamed;
  await commitSessions((map) => {
    map[sessionId].title = title;
    renamed = toPublicSession(map[sessionId]);
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
  const levels = await execution.reasoningLevels(provider, model);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar de modelo');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    await pi.configure(tx, session.conversationId, {
      model: { provider, modelId: model },
      thinkingLevel: execution.thinkingLevelFor(levels, current.reasoning_effort),
    });
    current.provider = provider;
    current.model = model;
    current.style = info.style || 'openai_chat';
    current.reasoning_levels = levels;
    current.updated_at = Date.now();
    return { session: toPublicSession(current) };
  }, ctx());
}

async function sessionReasoningSet(params) {
  const sessionId = _text(params.id, 'la conversación', 120, true);
  const effort = params.reasoning_effort;
  if (!execution.REASONING_EFFORTS.includes(effort)) throw validation('Nivel de razonamiento no válido');
  const session = await requireSession(sessionId);
  await execution.ensureProvider(session.provider, session.model);
  const levels = await execution.reasoningLevels(session.provider, session.model);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar el razonamiento');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    await pi.configure(tx, session.conversationId, { thinkingLevel: execution.thinkingLevelFor(levels, effort) });
    current.reasoning_effort = effort;
    current.reasoning_levels = levels;
    current.updated_at = Date.now();
    return { session: toPublicSession(current) };
  }, ctx());
}

async function sessionIncognitoSet(params) {
  const sessionId = _text(params.id, 'la conversación', 120, true);
  if (typeof params.incognito !== 'boolean') throw validation('El modo incógnito debe ser verdadero o falso');
  const session = await requireSession(sessionId);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar el modo incógnito');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    if (params.incognito) current.incognito = true;
    else delete current.incognito;
    delete current.memory_revision;
    current.updated_at = Date.now();
    return { session: toPublicSession(current) };
  }, ctx());
}

async function sessionPermissionsSet(params) {
  const sessionId = _text(params.id, 'la conversación', 120, true);
  const mode = params.permission_mode;
  if (!['ask', 'auto', 'full'].includes(mode)) throw validation('Modo de permisos no válido');
  const session = await requireSession(sessionId);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar los permisos');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    current.permission_mode = mode;
    current.updated_at = Date.now();
    return { session: toPublicSession(current) };
  }, ctx());
}

function auditRules(audit, before, after, scope, sessionId) {
  const list = Array.isArray(audit) ? audit : [];
  const channels = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const channel of channels) {
    const from = before && before[channel] ? before[channel] : null;
    const to = after && after[channel] ? after[channel] : null;
    if (from === to) continue;
    list.push({
      id: crypto.randomUUID(),
      at: Date.now(),
      scope,
      channel,
      from,
      to,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }
  return list.slice(-200);
}

async function policyState() {
  const doc = await shared.state.harness.snapshot(shared.state.PolicyDoc, ctx());
  return {
    rules: { ...((doc && doc.rules) || {}) },
    scoped_rules: Array.isArray(doc && doc.scoped_rules) ? doc.scoped_rules.map((rule) => ({ ...rule })) : [],
    audit: Array.isArray(doc && doc.audit) ? doc.audit.slice(-50).map((entry) => ({ ...entry })) : [],
  };
}

async function runGraph() {
  const { pi } = shared.deps;
  const all = Object.values(await sessions()).filter((session) => !session.deleted);
  const liveStates = new Map();
  for (const session of all) {
    let live = null;
    let inbox = null;
    try {
      live = await shared.state.harness.snapshot(pi.LiveDoc, session.conversationId, ctx());
      inbox = await shared.state.harness.snapshot(pi.InboxDoc, session.conversationId, ctx());
    } catch (err) {
      void err;
    }
    liveStates.set(session.id, {
      run: live && live.run ? live.run : null,
      inboxPending: !!(inbox && inbox.items && inbox.items.length),
    });
  }
  return require('./agent-run-graph').buildRunGraph(all.map(toPublicSession), liveStates);
}

function parseScopedRules(params) {
  if (params.scoped_rules === undefined) return null;
  try {
    return require('./agent-policy-engine').validateScopedRules(params.scoped_rules);
  } catch (err) {
    throw validation(String((err && err.message) || err));
  }
}

async function policyRulesSet(params) {
  let rules = null;
  if (params.rules !== undefined) {
    try {
      rules = validateRules(params.rules);
    } catch (err) {
      throw validation(String((err && err.message) || err));
    }
  }
  const scopedRules = parseScopedRules(params);
  if (rules === null && scopedRules === null) throw validation('Indica las reglas de canal o las reglas con alcance');
  if ([...shared.live.values()].some((live) => live.run || (live.inbox || []).length)) {
    throw validation('Espera a que terminen los turnos para cambiar las reglas globales');
  }
  const result = await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.PolicyDoc);
    const before = { ...(doc.rules || {}) };
    if (rules !== null) doc.rules = Object.keys(rules).length ? { ...rules } : {};
    if (scopedRules !== null) doc.scoped_rules = scopedRules;
    doc.audit = auditRules(doc.audit, before, doc.rules, 'global');
    return {
      rules: { ...doc.rules },
      scoped_rules: Array.isArray(doc.scoped_rules) ? doc.scoped_rules.map((rule) => ({ ...rule })) : [],
      audit: doc.audit.slice(-50).map((entry) => ({ ...entry })),
    };
  }, ctx());
  shared.globalRules = { ...result.rules };
  shared.globalScopedRules = result.scoped_rules.map((rule) => ({ ...rule }));
  return result;
}

async function saveSessionRule(sessionId, channel, rule) {
  let nextRules;
  try {
    nextRules = validateRules({ [channel]: rule });
  } catch (err) {
    throw validation(String((err && err.message) || err));
  }
  const { pi } = shared.deps;
  const result = await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    const before = { ...(current.approval_rules || {}) };
    const merged = { ...before, ...nextRules };
    let validated;
    try {
      validated = validateRules(merged);
    } catch (err) {
      throw validation(String((err && err.message) || err));
    }
    current.approval_rules = validated;
    current.updated_at = Date.now();
    const policy = await tx.doc(shared.state.PolicyDoc);
    policy.audit = auditRules(policy.audit, before, validated, 'session', sessionId);
    return { audit: policy.audit.slice(-50).map((entry) => ({ ...entry })) };
  }, ctx());
  return result.audit;
}

async function sessionRulesSet(params) {
  const sessionId = _text(params.id, 'la conversación', 120, true);
  let rules = null;
  if (params.rules !== undefined) {
    try {
      rules = validateRules(params.rules);
    } catch (err) {
      throw validation(String((err && err.message) || err));
    }
  }
  const scopedRules = parseScopedRules(params);
  if (rules === null && scopedRules === null) throw validation('Indica las reglas de canal o las reglas con alcance');
  const session = await requireSession(sessionId);
  const { pi } = shared.deps;
  return shared.state.harness.commit(async (tx) => {
    const live = await tx.doc(pi.LiveDoc, session.conversationId);
    const inbox = await tx.doc(pi.InboxDoc, session.conversationId);
    if (live.run || inbox.items.length) throw validation('Espera a que termine el turno para cambiar los permisos');
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) throw notFound(`Conversación no encontrada: ${sessionId}`);
    const before = { ...(current.approval_rules || {}) };
    let savedRules = null;
    if (rules !== null) {
      savedRules = Object.keys(rules).length ? { ...rules } : null;
      if (savedRules) current.approval_rules = savedRules;
      else delete current.approval_rules;
    }
    if (scopedRules !== null) {
      if (scopedRules.length) current.scoped_rules = scopedRules;
      else delete current.scoped_rules;
    }
    const policy = await tx.doc(shared.state.PolicyDoc);
    policy.audit = auditRules(policy.audit, before, savedRules || before, 'session', sessionId);
    current.updated_at = Date.now();
    return {
      session: toPublicSession(current),
      audit: policy.audit.slice(-50).map((entry) => ({ ...entry })),
    };
  }, ctx());
}

async function _syncReasoning(session) {
  const levels = await execution.reasoningLevels(session.provider, session.model);
  if (JSON.stringify(levels) === JSON.stringify(session.reasoning_levels)) return;
  const { pi } = shared.deps;
  await shared.state.harness.commit(async (tx) => {
    const current = (await tx.doc(shared.state.SessionsDoc)).sessions[session.id];
    if (!current || current.deleted) return;
    await pi.configure(tx, session.conversationId, {
      thinkingLevel: execution.thinkingLevelFor(levels, current.reasoning_effort),
    });
    current.reasoning_levels = levels;
  }, ctx());
}

async function sessionDelete(params) {
  const sessionId = String((params && params.id) || '');
  const session = await requireSession(sessionId);
  const conv = await conversation(sessionId);
  await Promise.all([
    require('./agent-tasks')
      .cancelDelegations(sessionId)
      .then(() => conv.abort(ctx(), { background: true }).catch(() => {})),
    conv.abort(ctx(), { background: true }).catch(() => {}),
  ]);
  await bridge('agent_internal_approvals_deny_session', { session_id: sessionId }).catch(() => {});
  await bridge('agent_internal_grants_revoke', { session_id: sessionId }).catch(() => {});
  await bridge('agent_internal_shell_jobs_cancel_session', { session_id: sessionId }).catch(() => {});
  await require('./agent-events')
    .cancelSession(sessionId)
    .catch(() => {});
  await deleteSessionAndPlan(sessionId);
  const watcher = shared.watchers.get(session.conversationId);
  if (watcher) {
    watcher.stop().catch(() => {});
    shared.watchers.delete(session.conversationId);
  }
  shared.live.delete(session.conversationId);
  shared.convToSession.delete(session.conversationId);
  shared.state.portableProfiles.delete(session.conversationId);
  return { deleted: true, id: sessionId };
}

async function messagesList(params, paged = false) {
  const sessionId = String((params && params.session_id) || '');
  const session = await requireSession(sessionId);
  const conv = await conversation(sessionId);
  await projection.ensureWatcher(session);
  const revision = projection.liveFor(session.conversationId).transcriptRevision ?? 0;
  const page = paged ? await projection.transcriptEntries(conv) : null;
  const { messages, pending, usage } = await projection.projectMessages(conv, session, page?.entries);
  const { artifacts, questions, panels, context } = await bridge('agent_internal_artifacts', { session_id: sessionId });
  const partial = projection.partialText(session.conversationId);
  const partialReasoning = projection.partialReasoning(session.conversationId);
  if (partial || partialReasoning) {
    const reasoningMs = projection.partialReasoningMs(session.conversationId, partialReasoning);
    messages.push({
      role: 'assistant',
      content: partial,
      ...(partialReasoning ? { reasoning: partialReasoning } : {}),
      ...(reasoningMs !== undefined ? { reasoning_ms: reasoningMs } : {}),
      partial: true,
      ts: Date.now(),
    });
  }
  const running = projection.isRunning(session.conversationId);
  const delegations = await require('./agent-tasks').roster(sessionId);
  const plan = _latestPlan(messages, await readPlan(sessionId));
  const stopped = messages.length > 0 && messages[messages.length - 1].content === CANCELLED_NOTE;
  const contextWindow = execution.contextWindowFor(session);
  const budget = await execution.profileBudget(await execution.sessionProfile(session));
  return {
    messages,
    ...(page ? { before: page.before, revision } : {}),
    running,
    delegations,
    plan,
    resumable:
      !running &&
      pending.length === 0 &&
      (!!session.continuation || stopped || !!(plan && plan.steps.some((step) => step.status !== 'done'))),
    pending_approvals: pending,
    artifacts,
    questions,
    panels: panels || [],
    context: {
      modules: session.modules || [],
      files: (context && context.files) || [],
      accounts: (context && context.accounts) || [],
      workspace: (context && context.workspace) || null,
    },
    usage: usage || null,
    context_window: contextWindow,
    compaction_thresholds: compactionPolicy.thresholdsFor(
      shared.state.compaction,
      execution.compactionWindowFor(session),
    ),
    compacting: (projection.liveFor(session.conversationId).compactions || []).length > 0,
    ...(budget ? { token_budget: { limit: budget.limit, used: budget.used } } : {}),
  };
}

async function messagesPage(params) {
  const { before, around } = params;
  if (before === undefined && around === undefined) return messagesList(params, true);
  const cursor = before ?? around;
  if ((before !== undefined && around !== undefined) || !Number.isSafeInteger(cursor) || cursor < 1)
    throw validation('Indica un cursor válido');
  const session = await requireSession(params.session_id);
  const conv = await conversation(session.id);
  const page = around === undefined ? await projection.transcriptEntries(conv, before) : await projection.transcriptAround(conv, around);
  const { messages } = await projection.projectMessages(conv, session, page.entries, true);
  return { messages, before: page.before };
}

async function messagesSearch(params) {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!query || query.length > 200) throw validation('La búsqueda admite de 1 a 200 caracteres');
  const session = await requireSession(params.session_id);
  return projection.searchTranscript(await conversation(session.id), query);
}

async function messageOrigin(params) {
  const { kind, ref } = params;
  if (!['artifact', 'task'].includes(kind) || typeof ref !== 'string' || !ref || ref.length > 200)
    throw validation('Indica un origen de conversación válido');
  const session = await requireSession(params.session_id);
  return { id: await projection.transcriptOrigin(await conversation(session.id), kind, ref) };
}

async function roomsList(params) {
  return require('./agent-rooms').listRooms(String((params && params.session_id) || ''));
}

async function memoryShare(params) {
  const profiles = await _profiles();
  if (params.profile_ids.some((id) => !Object.hasOwn(profiles, id) || ['own', 'none'].includes(profiles[id].memory_scope))) {
    throw validation('Elige perfiles con acceso a memoria compartida');
  }
  return bridge('agent_internal_memory_share', params);
}

function _latestPlan(messages, saved) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const calls = messages[i].tool_calls || [];
    for (let j = calls.length - 1; j >= 0; j -= 1) {
      const call = calls[j];
      if (call.name !== 'task_plan' || call.status !== 'done') continue;
      const plan = planFromParams(call.params);
      if (plan) return plan;
    }
  }
  return planFromParams(saved);
}

async function latestPlan(sessionId) {
  const session = await requireSession(sessionId);
  const saved = await readPlan(sessionId);
  const { messages } = await projection.projectMessages(await conversation(sessionId), session);
  return _latestPlan(messages, saved);
}

async function browserAction(params) {
  const browser = shared.browser || require('./agent-browser');
  const action = String((params && params.action) || 'state');
  if (action === 'state') return browser.state();
  if (action === 'bounds') return browser.dock(params.bounds || null);
  if (action === 'tab') return browser.activateTab(params.tab);
  if (action === 'new') return browser.newTab();
  if (action === 'close') return browser.closeTab(params.tab);
  if (action === 'control') return browser.setUserControl(params.user === true, params.tab);
  if (action === 'allow') return browser.allowAgent(params.tab);
  if (action === 'capture') return browser.capture(params.tab);
  if (action === 'inspect') return browser.inspect(params.x, params.y, params.tab);
  if (action === 'engines') return browser.engines();
  if (action === 'engine') return browser.setEngine(params.engine);
  if (['open', 'back', 'forward', 'reload'].includes(action)) return browser.navigate(action, params.url, params.tab);
  throw validation(`Acción del navegador no válida: ${action}`);
}

async function contextRemoveFile(params) {
  const sessionId = String((params && params.session_id) || '');
  await requireSession(sessionId);
  const filePath = String(params.path || '');
  if (!filePath) throw validation('Indica el archivo que quieres retirar');
  return bridge('agent_internal_grant_remove', { session_id: sessionId, path: filePath });
}

async function workspaceSet(params) {
  const sessionId = String((params && params.session_id) || '');
  const session = await requireSession(sessionId);
  if (params.select === true) {
    if (projection.isRunning(session.conversationId))
      throw validation('Espera a que termine el turno para cambiar la carpeta de trabajo');
    const dialog = shared.dialog || require('electron').dialog;
    const win = shared.dialog ? undefined : require('./window-manager').getMainWindow();
    const response = await dialog.showOpenDialog(win || undefined, {
      title: 'Seleccionar carpeta de trabajo del agente',
      properties: ['openDirectory'],
    });
    if (!response || response.canceled || !response.filePaths?.length) {
      const { context } = await bridge('agent_internal_artifacts', { session_id: sessionId });
      return { workspace: context?.workspace || null };
    }
    if (projection.isRunning((await requireSession(sessionId)).conversationId))
      throw validation('Espera a que termine el turno para cambiar la carpeta de trabajo');
    const result = await bridge('agent_internal_grants_add', {
      session_id: sessionId,
      paths: [],
      folders: [response.filePaths[0]],
    });
    if (!result.workspace) throw validation(result.rejected?.[0]?.reason || 'No se pudo activar la carpeta de trabajo');
    return { workspace: result.workspace };
  }
  const folder = typeof params.path === 'string' && params.path ? params.path : undefined;
  return bridge('agent_internal_workspace_set', { session_id: sessionId, ...(folder ? { path: folder } : {}) });
}

async function messageSend(params) {
  const sessionId = String((params && params.session_id) || '');
  const session = await requireSession(sessionId);
  const content = String(params.content || '')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
  if (!content && (!Array.isArray(params.attachments) || !params.attachments.length))
    throw validation('El mensaje está vacío');
  const requestId =
    typeof params.request_id === 'string' && params.request_id
      ? params.request_id.slice(0, MAX_REQUEST_ID_CHARS)
      : undefined;
  const correction = params.correction === true;
  const admitted = requestId && (await _admittedRequest(session, requestId));
  if (admitted) {
    if (correction && admitted.status === 'queued') {
      const { denied } = await bridge('agent_internal_approvals_deny_session', { session_id: sessionId });
      for (const id of denied || []) execution.notifyDecision(id);
    }
    return { accepted: true, duplicate: true };
  }
  resolvePortableProfile(shared.state.portableProfiles, session.conversationId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  if (pending.length && !correction)
    throw validation('Resuelve primero las aprobaciones pendientes de esta conversación');
  const budget = await execution.profileBudget(await execution.sessionProfile(session));
  if (budget && budget.exhausted) {
    throw validation(
      'Este agente agotó su presupuesto diario de tokens; podrás seguir mañana o al ampliar su presupuesto',
    );
  }
  await execution.refreshTools();
  await execution.ensureProvider(session.provider, session.model);
  await _syncReasoning(session);
  const conv = await conversation(sessionId);
  const saved = Object.values(await _profiles());
  const mentionedBots = new Map();
  const normalizeMention = (value) =>
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-');
  const moduleAliases = new Set(
    Object.entries(require('../shared/agent-modules.json').modules)
      .flatMap(([id, spec]) => [id, spec.label, ...(spec.aliases || [])])
      .map(normalizeMention),
  );
  const mentionText = content.replace(
    /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|(?<![\p{L}\p{N}_@/])@(?:"([^"\r\n]+)"|bot:([a-zA-Z0-9_-]+)|([\p{L}\p{N}_-]+))/gu,
    (match, quoted, id, plain) => {
      if (match.startsWith('`')) return match;
      if (plain && moduleAliases.has(normalizeMention(plain))) return match;
      const found = saved.filter((profile) =>
        id ? profile.id === id : normalizeMention(profile.name) === normalizeMention(quoted || plain),
      );
      if (found.length > 1)
        throw validation(
          `@${quoted || plain} identifica varios bots; selecciónalo en las sugerencias de @ para usar su identificador`,
        );
      if (!found.length) {
        if (quoted || id) throw validation(`El bot mencionado ya no existe: ${quoted || id}`);
        return match;
      }
      mentionedBots.set(found[0].id, { id: found[0].id, name: found[0].name });
      return ' '.repeat(match.length);
    },
  );
  const delegationTool = (await conv.agent(ctx())).tools.some((tool) => tool.name === 'agent_delegate')
    ? 'agent_delegate'
    : 'subagent_run';
  if (mentionedBots.size && !(await conv.agent(ctx())).tools.some((tool) => tool.name === delegationTool)) {
    throw validation(
      'Activa agent_delegate o subagent_run en Herramientas del agente para delegar en un bot; mencionar no habilita herramientas',
    );
  }
  await projection.ensureWatcher(session);
  let skill = null;
  if (params.skill_id !== undefined) {
    if (projection.isRunning(session.conversationId))
      throw validation('Espera a que termine el turno en curso para invocar una skill');
    if (!(await conv.agent(ctx())).tools.some((tool) => tool.name === 'skills_read')) {
      throw validation(
        'Activa skills_read en Herramientas del agente para invocar una skill; elegir una skill no habilita herramientas',
      );
    }
    ({ skill } = await bridge('agent_internal_skill_resolve', {
      session_id: sessionId,
      skill_id: String(params.skill_id),
      profile_id: session.profile?.id || null,
    }));
  }
  const attached = _takeAttachments(params.attachments);
  const paths = attached.filter((a) => a.kind === 'files').map((a) => a.path);
  const folders = attached.filter((a) => a.kind === 'folder').map((a) => a.path);
  const files =
    paths.length || folders.length
      ? await bridge('agent_internal_grants_add', {
          session_id: sessionId,
          request_id: requestId || null,
          paths,
          folders,
        })
      : { granted: [], rejected: [] };
  const nativeNames = [...shared.toolSpecs.values()].filter((t) => t.kind === 'native').map((t) => t.name);
  const mentions = await bridge('agent_internal_mentions', { text: mentionText, native_tools: nativeNames });
  const mentionedTools = [
    ...execution.moduleToolNames(mentions.modules || []),
    ...(mentions.mcp_tools || []).filter((name) => shared.toolSpecs.has(name)),
  ];
  if (mentionedTools.length) {
    const current = (await conv.agent(ctx())).tools.map((tool) => tool.name);
    const allows = await execution.profileToolFilter(session);
    const extra = mentionedTools.filter((name) => !current.includes(name) && (!allows || allows(name)));
    if (current.includes(execution.TOOLS_LOAD) && extra.length) {
      await conv.configure({ tools: [...current, ...extra].map((name) => ({ name })) }, ctx());
    }
  }
  const { context: fileContext } = await bridge('agent_internal_artifacts', { session_id: sessionId });
  const workspace = fileContext?.workspace || files.workspace;
  const attachedNote = [
    attached.length
      ? `Archivos adjuntos por el usuario:\n${attached.map((a) => `- ${a.path} (${a.kind === 'folder' ? 'carpeta' : 'archivo'})`).join('\n')}`
      : '',
    workspace
      ? `Espacio de trabajo activo: ${workspace}. Esta es la carpeta de trabajo de la conversación, no un adjunto de solo lectura. ` +
        'Usa fs_* para leer, crear y editar archivos ahí; shell_run y shell_job_start sin cwd arrancan en esa carpeta. ' +
        'Conserva los modos de aprobación y verifica los resultados.'
      : 'Sin carpeta de trabajo activa: las rutas relativas se resuelven en los borradores de la conversación.',
  ]
    .filter(Boolean)
    .join('\n\n');
  await memoryContext(session, content);
  const agentConfig = await conv.agent(ctx());
  const storedInstructions = String(agentConfig.instructions || '');
  const instructions = migrateInstructions(storedInstructions);
  if (instructions !== storedInstructions) await conv.configure({ instructions }, ctx());
  const skillsNote = instructions.includes(SKILLS_GUIDE) ? '' : SKILLS_GUIDE;
  const skillIndex = await skillsIndex(session, agentConfig.tools);
  const legacyGuidance = legacyNotes(instructions);
  const botsNote = mentionedBots.size
    ? `El usuario solicita colaborar con estos bots guardados: ${JSON.stringify([...mentionedBots.values()])}. ` +
      `Usa ${delegationTool} con su id exacto en agent y un encargo autocontenido. Si son varios, reparte el trabajo y transmite ` +
      'las conclusiones verificadas necesarias al siguiente bot. Integra sus resultados y explica cualquier fallo. ' +
      'No confundas una mención con una ejecución: solo informa de colaboraciones que tengan un comprobante. ' +
      'Los bots delegados solo leen, no pueden delegar de nuevo ni acceden por sí solos a otros chats. ' +
      'No amplíes herramientas ni permisos por una mención.'
    : '';
  const invokedSkillNote = skill
    ? `El usuario invocó la skill «${skill.name}» (skill_id ${skill.id}). Antes de cualquier otra herramienta llama a skills_read ` +
      'con ese skill_id y sigue next_offset hasta leer SKILL.md completo; después aplica sus instrucciones a este encargo. ' +
      skill.notice
    : '';
  const continuationNote = await continuationContext(session);
  const context = [
    continuationNote,
    mentions.context,
    attachedNote,
    skillsNote,
    skillIndex?.note,
    ...legacyGuidance,
    botsNote,
    invokedSkillNote,
    attached.length
      ? `${shared.ATTACHMENTS_MARKER}\n${JSON.stringify(attached.map((item) => ({ path: item.path, folder: item.kind === 'folder' })))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const images = await _inlineImages(
    conv,
    attached,
    (files.rejected || []).map((item) => item.path),
  );
  const input =
    context || images.length
      ? [
          ...(content ? [{ type: 'text', text: content }] : []),
          ...images,
          ...(context ? [{ type: 'text', text: `${shared.CONTEXT_MARKER}\n${context}` }] : []),
        ]
      : content;
  if (!projection.isRunning(session.conversationId)) {
    shared.rounds.delete(session.conversationId);
    shared.turns.delete(session.conversationId);
    execution.requireSkill(session.conversationId, null);
  }
  if (skill && skill.warning) {
    await conv.submit(
      {
        type: 'write',
        ...(requestId ? { requestId: `${requestId}:skill` } : {}),
        entry: { kind: shared.NOTICE_KIND, data: { text: skill.warning } },
      },
      ctx(),
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (skill) execution.requireSkill(session.conversationId, skill.id);
      await conv.submit(
        {
          type: 'input',
          content: input,
          whenBusy: correction ? 'steer' : 'followUp',
          ...(requestId ? { requestId } : {}),
        },
        ctx(),
      );
      if (skillIndex) shared.skillIndexes.set(session.conversationId, skillIndex.index);
      break;
    } catch (err) {
      if (skill) execution.requireSkill(session.conversationId, null);
      if (!(err && (err.name === 'ConversationBusy' || /busy/i.test(err.message || '')))) throw err;
      if (attempt === 1) throw validation('Ya hay un turno en curso en esta conversación');
      await Promise.race([conv.waitForIdle(ctx()), new Promise((r) => setTimeout(r, 5000))]);
    }
  }
  if (correction) shared.turns.get(session.conversationId)?.calls.clear();
  try {
    require('./agent-browser').resetUserActivity();
  } catch {}
  if (pending.length) {
    const { denied } = await bridge('agent_internal_approvals_deny_session', { session_id: sessionId });
    for (const id of denied || []) execution.notifyDecision(id);
  }
  await commitSessions((map) => {
    const s = map[sessionId];
    if (s) {
      const known = new Map((s.modules || []).map((m) => [m.id, m]));
      for (const id of mentions.modules || [])
        known.set(id, { id, label: (mentions.labels && mentions.labels[id]) || id });
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

async function filePreview(params) {
  const sessionId = String(params.session_id || '');
  await requireSession(sessionId);
  const { resource, attachment_id: attachmentId, page = 0, sheet = 0 } = params;
  const hasResource = typeof resource === 'string' && !!resource;
  const hasAttachment = typeof attachmentId === 'string' && !!attachmentId;
  if (
    ![page, sheet].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    hasResource === hasAttachment ||
    (resource !== undefined && !hasResource) ||
    (attachmentId !== undefined && !hasAttachment)
  ) {
    throw validation('Indica un archivo y una página u hoja válidos');
  }
  if (hasAttachment) {
    const [item] = _takeAttachments([attachmentId]);
    if (item.kind === 'folder') throw validation('Selecciona un archivo para previsualizar');
    return bridge('agent_internal_file_preview', { session_id: sessionId, selected_file: item.path, page, sheet });
  }
  return bridge('agent_internal_file_preview', { session_id: sessionId, resource, page, sheet });
}

async function attach(params) {
  const kind = params && params.kind === 'folder' ? 'folder' : 'files';
  let filePaths;
  if (Array.isArray(params && params.paths) || Array.isArray(params && params.data)) {
    filePaths = [...(await _droppedPaths(params.paths)), ...(await _pastedFiles(params.data))];
  } else {
    const dialog = shared.dialog || require('electron').dialog;
    const win = shared.dialog ? undefined : require('./window-manager').getMainWindow();
    const response = await dialog.showOpenDialog(win || undefined, {
      title: kind === 'folder' ? 'Adjuntar carpeta para el agente' : 'Adjuntar archivos para el agente',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
    });
    if (!response || response.canceled || !Array.isArray(response.filePaths)) return { attachments: [] };
    filePaths = response.filePaths;
  }
  const now = Date.now();
  for (const [id, item] of shared.attachments) {
    if (now - item.created > ATTACHMENT_TTL_MS) shared.attachments.delete(id);
  }
  const attachments = filePaths.slice(0, MAX_ATTACHMENTS).map((filePath) => {
    const id = crypto.randomBytes(9).toString('hex');
    shared.attachments.set(id, { path: filePath, kind, created: now });
    return { id, name: path.basename(filePath), kind };
  });
  return { attachments };
}

async function _droppedPaths(paths) {
  const out = [];
  for (const raw of Array.isArray(paths) ? paths.slice(0, MAX_ATTACHMENTS) : []) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) throw validation('Ruta de adjunto no válida');
    const stat = await fs.promises.stat(raw).catch(() => null);
    if (!stat || !stat.isFile()) throw validation(`No se puede adjuntar: ${path.basename(raw)}`);
    out.push(raw);
  }
  return out;
}

async function _pastedFiles(data) {
  const items = Array.isArray(data) ? data.slice(0, MAX_ATTACHMENTS) : [];
  if (!items.length) return [];
  const dir = path.join(_agentDir(), 'attachments');
  await fs.promises.mkdir(dir, { recursive: true });
  const out = [];
  for (const item of items) {
    const bytes = Buffer.from(typeof item?.data === 'string' ? item.data : '', 'base64');
    if (!bytes.length || bytes.length > MAX_PASTED_BYTES)
      throw validation('El archivo pegado está vacío o supera 20 MB');
    const name =
      path
        .basename(String(item.name || ''))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .slice(0, 80) || 'pegado';
    const target = path.join(dir, `${crypto.randomBytes(6).toString('hex')}-${name}`);
    await fs.promises.writeFile(target, bytes);
    out.push(target);
  }
  return out;
}

async function _inlineImages(conv, attached, rejected) {
  const candidates = attached.filter(
    (a) => a.kind === 'files' && !rejected.includes(a.path) && IMAGE_MIME[path.extname(a.path).toLowerCase()],
  );
  if (!candidates.length) return [];
  const ref = (await conv.agent(ctx())).model;
  const model = ref && shared.state.models.getModel(ref.provider, ref.modelId);
  if (!model || !model.input.includes('image')) return [];
  const images = [];
  for (const item of candidates) {
    const stat = await fs.promises.stat(item.path).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_INLINE_IMAGE_BYTES) continue;
    images.push({
      type: 'image',
      data: (await fs.promises.readFile(item.path)).toString('base64'),
      mimeType: IMAGE_MIME[path.extname(item.path).toLowerCase()],
    });
  }
  return images;
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
  } catch {}
  try {
    const email = require('./autoimg-user-scope').getActiveEmail();
    if (email) accounts.autoimg = String(email);
  } catch {}
  return accounts;
}

function _toolVersion(spec) {
  const shape = { description: spec.description || '', inputSchema: spec.inputSchema || null, gated: !!spec.gated };
  return {
    name: spec.name,
    version: crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16),
  };
}

async function skillsIndex(session, tools) {
  if (!tools.some((tool) => tool.name === 'skills_read')) return null;
  const { skills } = await bridge('agent_skills_list', {}).catch(() => ({ skills: [] }));
  const index = (skills || [])
    .slice(0, MAX_INDEXED_SKILLS)
    .map((skill) => `- ${skill.name} (skill_id ${skill.id}): ${String(skill.description || '').slice(0, 160)}`)
    .join('\n');
  if (!index || shared.skillIndexes.get(session.conversationId) === index) return null;
  return {
    index,
    note:
      'Skills disponibles. Si alguna encaja con el encargo, aunque sea en parte, cárgala con skills_read antes de actuar ' +
      'y sigue sus instrucciones; skills_list encuentra además las de carpetas adjuntas y del perfil.\n' +
      index,
  };
}

async function memoryContext(session, initialText) {
  if (!(await regenerateMemorySnapshot(session.id))) await _writeMemorySnapshot(session, initialText);
  return { context: '' };
}

async function _writeMemorySnapshot(session, initialText, checkpoint) {
  const { harness, SessionsDoc, ProfilesDoc } = shared.state;
  const { AgentDoc, configure } = shared.deps.pi;
  const profileId = !session.profile?.portable ? session.profile?.id : null;
  const profile = await execution.sessionProfile(session);
  const scope = profile ? profile.memory_scope || 'shared-read' : null;
  const scopeChanged = scope !== (session.memory_snapshot_scope ?? null);
  let revision = null;
  let context;
  try {
    ({ revision = null } = await bridge('agent_internal_memory_revision', {}));
    if (!checkpoint && !scopeChanged && revision !== null && revision === session.memory_revision) return false;
    ({ context } = await bridge('agent_internal_memory_context', {
      session_id: session.id,
      text: initialText,
      tools: [...shared.toolSpecs.values()].map(_toolVersion),
      accounts: _accounts(),
      profile_id: session.profile?.id || null,
      memory_scope: profile?.memory_scope || null,
      incognito: session.incognito === true,
      private_memory: !session.delegation,
    }));
    if (checkpoint && profile?.memory_scope !== 'none' && !session.incognito && !session.delegation) await _promoteCandidates(session, initialText);
  } catch (error) {
    if (checkpoint) throw error;
    if (!scopeChanged) return false;
    revision = null;
    context = '';
  }
  return harness.commit(async (tx) => {
    const current = (await tx.doc(SessionsDoc)).sessions[session.id];
    if (!current || current.deleted) return false;
    const currentProfile = profileId ? (await tx.doc(ProfilesDoc)).profiles[profileId] : null;
    const currentScope = currentProfile ? currentProfile.memory_scope || 'shared-read' : null;
    if (currentScope !== scope || !!current.incognito !== !!session.incognito) return false;
    if (
      checkpoint &&
      (current.memory_checkpoint === checkpoint.id || (await tx.latestHeadMarker(session.conversationId))?.id !== checkpoint.id)
    ) return false;
    const storedScope = current.memory_snapshot_scope ?? null;
    const staleRevision =
      revision === null
        ? current.memory_revision !== session.memory_revision || storedScope !== (session.memory_snapshot_scope ?? null)
        : storedScope === scope &&
          (current.memory_revision > revision || (!checkpoint && current.memory_revision === revision));
    if (staleRevision) return false;
    const stored = (await tx.doc(AgentDoc, session.conversationId)).instructions || '';
    const instructions = withMemorySnapshot(stored, context);
    if (instructions !== stored) await configure(tx, session.conversationId, { instructions });
    if (revision === null) delete current.memory_revision;
    else current.memory_revision = revision;
    if (scope === null) delete current.memory_snapshot_scope;
    else current.memory_snapshot_scope = scope;
    if (checkpoint) current.memory_checkpoint = checkpoint.id;
    return true;
  }, ctx());
}

async function _promoteCandidates(session, summary) {
  if (session.incognito === true || session.delegation) return;
  const items = compactionPolicy.memoryCandidates(summary);
  if (!items.length) return;
  try {
    const counts = await bridge('agent_internal_memory_promote', { session_id: session.id, items });
    require('./app-log').logInfo(
      `[agent] memoria candidata de ${session.id}: ${counts.promoted} promovidos, ${counts.updated} renovados, ` +
        `${counts.deduplicated} deduplicados, ${counts.rejected} descartados`,
    );
  } catch (err) {
    console.error(`[agent] no se pudo promover la memoria candidata: ${execution.sanitizeProviderError(err.message)}`);
  }
}

const memoryRefreshes = new Map();

function regenerateMemorySnapshot(sessionId) {
  if (memoryRefreshes.has(sessionId)) return memoryRefreshes.get(sessionId);
  const refresh = _refreshCommittedMemory(sessionId)
    .catch((err) => console.error(`[agent] no se pudo actualizar la memoria: ${execution.sanitizeProviderError(err.message)}`))
    .finally(() => memoryRefreshes.delete(sessionId));
  memoryRefreshes.set(sessionId, refresh);
  return refresh;
}

async function _refreshCommittedMemory(sessionId) {
  const { harness, SessionsDoc } = shared.state;
  const { pi } = shared.deps;
  let refreshed = false;
  let attempted;
  for (;;) {
    const candidate = await harness.commit(async (tx) => {
      const session = (await tx.doc(SessionsDoc)).sessions[sessionId];
      if (!session || session.deleted) return undefined;
      const head = await tx.latestHeadMarker(session.conversationId);
      if (head?.kind !== pi.CompactionEntry.kind || head.id === session.memory_checkpoint) return undefined;
      return { session: { ...session, profile: session.profile ? { ...session.profile } : session.profile }, head };
    }, ctx());
    if (!candidate || candidate.head.id === attempted) return refreshed;
    const { session, head } = candidate;
    attempted = head.id;
    const content = head.model?.[0]?.content;
    const summary = compactionPolicy.unwrapCompactionSummary(typeof content === 'string' ? content : content?.[0]?.text);
    if (!summary) return refreshed;
    if (!(await _writeMemorySnapshot(session, summary, head))) continue;
    refreshed = true;
    shared.skillIndexes.delete(session.conversationId);
    compactionPolicy.recordCommittedCompaction(session, head, summary);
  }
}

async function _admittedRequest(session, requestId) {
  const found = await shared.state.harness.commit(
    (tx) => tx.submissionByRequest(session.conversationId, requestId),
    ctx(),
  );
  return found;
}

async function toolsList(params = {}) {
  let enabled;
  let tools;
  let session = null;
  if (params.session_id) {
    await execution.refreshTools();
    const conv = await conversation(String(params.session_id));
    session = (await sessions())[String(params.session_id)] || null;
    enabled = new Set((await conv.agent(ctx())).tools.map((tool) => tool.name));
    tools = [...shared.toolSpecs.values()];
  } else {
    tools = await execution.allToolSpecs();
  }
  tools = tools.filter((tool) => tool.name !== 'agent_wake_parent' || !!session?.delegation);
  return {
    tools: tools.map((t) => ({
      name: t.name,
      gated: !!t.gated,
      kind: ['mcp', 'native'].includes(t.kind) ? t.kind : 'backend',
      module: t.module || null,
      ...(enabled ? { enabled: enabled.has(t.name) } : {}),
    })),
  };
}

async function toolsSet(params) {
  const conv = await conversation(String((params && params.session_id) || ''));
  const names = params.names;
  if (names !== null && (!Array.isArray(names) || names.some((name) => typeof name !== 'string'))) {
    throw validation('Selecciona una lista de herramientas o restablece la selección');
  }
  const available = new Set((await execution.allToolSpecs()).map((tool) => tool.name));
  if (names && names.some((name) => !available.has(name)))
    throw validation('La selección contiene herramientas no disponibles');
  const session = await requireSession(String(params.session_id || ''));
  const allows = await execution.profileToolFilter(session);
  if (allows && names && names.some((name) => !allows(name))) {
    throw validation('El agente guardado de esta conversación no permite alguna de esas herramientas');
  }
  await execution.refreshTools();
  const selected =
    names !== null
      ? [...new Set(names)]
      : execution.profileInitialTools(await execution.sessionProfile(session), [...shared.toolSpecs.values()]);
  await conv.configure({ tools: selected && selected.map((name) => ({ name })) }, ctx());
  return toolsList(params);
}

async function turnStatus(params) {
  const sessionId = String((params && params.session_id) || '');
  const session = await requireSession(sessionId);
  await projection.ensureWatcher(session);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  return {
    running: projection.isRunning(session.conversationId),
    pending_approvals: pending,
    last_error: session.last_error || null,
    compacting: (projection.liveFor(session.conversationId).compactions || []).length > 0,
  };
}

async function turnCancel(params) {
  const sessionId = String((params && params.session_id) || '');
  const session = await requireSession(sessionId);
  await projection.ensureWatcher(session);
  const live = projection.liveFor(session.conversationId);
  const pending = (await bridge('agent_internal_approvals_pending', { session_id: sessionId })).approvals;
  const busy = !!live.run || (live.inbox || []).length > 0;
  const conv = await conversation(sessionId);
  const [children] = await Promise.all([
    require('./agent-tasks')
      .cancelDelegations(sessionId)
      .then(async (count) => {
        await conv.abort(ctx());
        return count;
      }),
    conv.abort(ctx()),
  ]);
  if (!busy && pending.length === 0 && !children) return { cancelled: false };
  if (pending.length) await bridge('agent_internal_approvals_deny_session', { session_id: sessionId });
  await conv
    .submit(
      {
        type: 'write',
        entry: { kind: NOTICE_KIND, data: { text: CANCELLED_NOTE } },
      },
      ctx(),
    )
    .catch(() => {});
  return { cancelled: true };
}

function scopedRuleForApproval(approval) {
  const engine = require('./agent-policy-engine');
  const method = String((approval && approval.method) || '');
  const params = (approval && approval.params) || {};
  let candidate = null;
  if (method === 'shell_run' || method === 'shell_job_start') {
    const command = typeof params.command === 'string' ? params.command.trim() : '';
    const singleSegment = command && !/&&|\|\||[;|]/.test(command);
    if (singleSegment) candidate = { scope: 'command', value: command, decision: 'allow' };
  } else if (typeof params.path === 'string' && params.path.trim() && /^(fs_|spreadsheet_)/.test(method)) {
    // La regla vive en el mismo espacio que la evaluación: los params crudos.
    // La unidad útil de recuerdo es la carpeta cuando la hay —una regla de
    // archivo exacto no cubriría nunca una escritura nueva— y el matching de
    // paths ya es por prefijo con separadores normalizados. Un archivo suelto
    // en la raíz del workspace degrada a regla exacta de ese archivo.
    const trimmed = params.path.trim().replace(/[\\/]+$/, '');
    const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    candidate = { scope: 'path', value: cut > 0 ? trimmed.slice(0, cut) : trimmed, decision: 'allow' };
  } else if (/^mcp2?__/.test(method)) {
    // Los alias mcp2 llevan hashes irreversibles: la regla se guarda con la
    // identidad real del contexto verificado, la misma que matchea el motor.
    const context = (approval && approval.context) || {};
    const server = typeof context.server_name === 'string' && context.server_name.trim()
      ? context.server_name.trim() : null;
    const toolName = typeof context.tool === 'string' && context.tool.trim() ? context.tool.trim() : null;
    if (server && toolName) candidate = { scope: 'mcp', value: `${server}/${toolName}`, decision: 'allow' };
    else if (server) candidate = { scope: 'mcp', value: server, decision: 'allow' };
  }
  if (!candidate) return null;
  try {
    return engine.validateScopedRules([candidate])[0] || null;
  } catch {
    return null;
  }
}

async function addSessionScopedRule(sessionId, rule) {
  const engine = require('./agent-policy-engine');
  return shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.SessionsDoc);
    const current = doc.sessions[sessionId];
    if (!current || current.deleted) return false;
    const existing = Array.isArray(current.scoped_rules) ? current.scoped_rules : [];
    const key = `${rule.scope}:${engine.normalizeScopeValue(rule.scope, rule.value)}`;
    if (existing.some((item) => `${item.scope}:${item.value}` === key && item.decision === rule.decision)) return true;
    const merged = [...existing.filter((item) => `${item.scope}:${item.value}` !== key), rule].slice(-engine.MAX_SCOPED_RULES);
    current.scoped_rules = engine.validateScopedRules(merged);
    current.updated_at = Date.now();
    return true;
  }, ctx());
}

async function approve(params, approved) {
  const approvalId = String((params && params.approval_id) || '');
  const channel = typeof params.channel === 'string' ? params.channel : '';
  const rule = params.rule === 'allow' || params.rule === 'deny' ? params.rule : null;
  if ((channel && !rule) || (rule && !channel)) throw validation('Indica el canal y la regla juntos');
  if (rule) {
    if (rule !== (approved ? 'allow' : 'deny')) throw validation('La regla no coincide con la decisión');
    const { approval: current } = await bridge('agent_internal_approval_status', { approval_id: approvalId });
    if (!current || current.status !== 'pending') {
      throw validation(
        current && current.status === 'expired'
          ? 'La aprobación expiró; vuelve a pedírselo al agente'
          : 'La aprobación ya no está pendiente',
      );
    }
    await saveSessionRule(String(current.session_id), channel, rule);
  }
  const { approval } = await bridge('agent_internal_approval_decide', {
    approval_id: approvalId,
    approve: !!approved,
    source: 'manual',
    ...(params.grant_app ? { grant_app: true } : {}),
    ...(approved && params.remember === true ? { remember: true } : {}),
  });
  const remembered =
    approved && params.remember === true && approval && approval.status === 'approved'
      ? String(approval.method || '')
      : null;
  if (remembered !== null && !remembered.startsWith('web_') && !remembered.startsWith('cua_') && approval.channel) {
    // Recuerdo granular: si la acción tiene un objetivo extraíble (comando, ruta o herramienta MCP)
    // se guarda una regla con scope exacto; solo cuando no hay objetivo se degrada al canal completo.
    const scopedRule = scopedRuleForApproval(approval);
    try {
      if (scopedRule) await addSessionScopedRule(String(approval.session_id), scopedRule);
      else await saveSessionRule(String(approval.session_id), String(approval.channel), 'allow');
    } catch {}
  }
  execution.notifyDecision(approvalId);
  if (remembered !== null && remembered.startsWith('web_')) {
    try {
      const policy = require('./agent-browser-policy');
      const domain = policy.hostOf(approval.context && approval.context.page_url);
      if (domain && !policy.isBlocked(domain)) policy.addAlwaysAllowed(domain);
    } catch {}
  }
  const approvalCall = approval && execution.callKey(String(approval.session_id), String(approval.call_id));
  const approvalSession = approval && (await sessions())[String(approval.session_id)];
  const approvalLive = approvalSession && shared.live.get(approvalSession.conversationId);
  const liveWait =
    approval &&
    (shared.liveApprovals.has(approval.id) ||
      shared.approvalsByCall.has(approvalCall) ||
      ((approvalLive && approvalLive.tools) || []).some(
        (t) => t.callId === providerCallId(approval.call_id) && t.status !== 'done',
      ));
  if (approval && !liveWait) {
    await new Promise((r) => setTimeout(r, 150));
    const stillLive = shared.liveApprovals.has(approval.id) || shared.approvalsByCall.has(approvalCall);
    if (!stillLive) void _settleRecoveredApproval(approval).catch(() => {});
  }
  return { approval };
}

async function effectUndo(params) {
  const sessionId = _text(params.session_id, 'la conversación', 120, true);
  const callId = _text(params.call_id, 'la acción', 200, true);
  await requireSession(sessionId);
  const result = await bridge('agent_internal_effect_undo', { session_id: sessionId, call_id: callId });
  try {
    const conv = await conversation(sessionId);
    const name = path.basename(String((result && result.path) || '')) || 'el archivo';
    await conv.submit(
      {
        type: 'write',
        requestId: `undo:${callId}`,
        entry: {
          kind: NOTICE_KIND,
          data: {
            text:
              `El usuario deshizo la acción sobre «${name}». ` +
              'No asumas que el archivo conserva el contenido escrito: vuelve a leerlo antes de usarlo o de repetir la acción.',
          },
        },
      },
      ctx(),
    );
  } catch {}
  return result;
}

async function _settleRecoveredApproval(approval) {
  const sessionId = String(approval.session_id || '');
  const session = (await sessions())[sessionId];
  if (!session || session.deleted) return;
  const conv = await shared.state.harness.conversation(session.conversationId, ctx());
  if (!conv) return;
  const callId = providerCallId(approval.call_id);
  const method = String(approval.method || '');

  const already = await _resultEntryFor(conv, callId);
  if (already) return;

  let text;
  let isError = false;
  let diagnostics;
  if (approval.status === 'approved') {
    try {
      text = await execution.dispatchApproved(approval, ctx());
      try {
        isError = !!JSON.parse(text).error;
      } catch {}
    } finally {
      try {
        require('./agent-browser').release(sessionId);
      } catch {}
    }
  } else {
    text = JSON.stringify({ error: 'El usuario rechazó esta acción' });
    isError = true;
    diagnostics = [{ severity: 'info', message: 'denied', code: 'blocked' }];
  }
  await conv.submit(
    {
      type: 'write',
      entry: {
        kind: 'pi.tool-result',
        model: [
          {
            role: 'toolResult',
            toolCallId: callId,
            toolName: method,
            content: [{ type: 'text', text }],
            isError,
            timestamp: Date.now(),
          },
        ],
        ...(diagnostics ? { data: { diagnostics } } : {}),
      },
    },
    ctx(),
  );
}

function tasksList(params) {
  return require('./agent-tasks').listTasks(params || {});
}

function tasksSave(params) {
  return require('./agent-tasks').saveTask(params || {});
}

function tasksCancel(params) {
  return require('./agent-tasks').cancelTask(params || {});
}

function tasksRun(params) {
  return require('./agent-tasks').runTaskNow(params || {});
}

function tasksQueue(params) {
  return require('./agent-tasks').queueControl(params || {});
}

function tasksRespond(params) {
  return require('./agent-tasks').respondToTask(params || {});
}

function tasksVerify(params) {
  return require('./agent-tasks').verifyTask(params || {});
}

async function _resultEntryFor(conv, callId) {
  const entries = await projection.allEntries(conv);
  const owner = entries.findLastIndex(
    (entry) =>
      entry.kind === 'pi.assistant' &&
      entry.model &&
      entry.model[0] &&
      (entry.model[0].content || []).some((block) => block && block.type === 'toolCall' && block.id === callId),
  );
  return entries
    .slice(owner + 1)
    .some(
      (entry) =>
        entry.kind === 'pi.tool-result' && entry.model && entry.model[0] && entry.model[0].toolCallId === callId,
    );
}

async function shutdown() {
  await require('./agent-tasks').stop();
  for (const stream of shared.watchers.values()) {
    try {
      await stream.stop();
    } catch {}
  }
  shared.watchers.clear();
  shared.live.clear();
  require('./agent-browser').close();
  require('./agent-cua').close();
  if (shared.state) {
    const harness = shared.state.harness;
    shared.state = null;
    try {
      await harness.close(ctx());
    } catch {}
  }
}

module.exports = {
  memoryContext,
  regenerateMemorySnapshot,
  latestPlan,
  activitySnapshot: async () => {
    if (!shared.state) return [];
    const { attention = {} } = await bridge('agent_internal_activity', {});
    const waitsDoc = await shared.state.harness.snapshot(shared.state.WaitsDoc, ctx());
    const activeWaits = new Set(
      Object.values((waitsDoc && waitsDoc.waits) || {})
        .filter(
          (wait) =>
            wait.status === 'waiting' && (wait.active_boot || wait.boot) === shared.boot && wait.deadline > Date.now(),
        )
        .map((wait) => wait.session_id),
    );
    return Object.values(await sessions())
      .filter((session) => !session.deleted)
      .map((session) => ({
        id: session.id,
        title: session.title || 'Conversación',
        status:
          attention[session.id] ||
          (shared.waitingInput.has(session.id)
            ? 'waiting_input'
            : [...shared.approvalsByCall].some(
                  ([key, id]) => key.startsWith(`${session.id}:`) && shared.liveApprovals.has(id),
                )
              ? 'waiting_approval'
              : activeWaits.has(session.id)
                ? 'waiting_event'
                : projection.isRunning(session.conversationId)
                  ? 'running'
                  : session.continuation
                    ? 'waiting_input'
                    : session.last_error
                      ? 'failed'
                      : 'completed'),
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
    agent_session_incognito_set: sessionIncognitoSet,
    agent_session_permissions_set: sessionPermissionsSet,
    agent_session_rules_set: sessionRulesSet,
    agent_policy_get: policyState,
    agent_policy_rules_set: policyRulesSet,
    agent_run_graph: runGraph,
    agent_session_reasoning_set: sessionReasoningSet,
    agent_messages_list: messagesList,
    agent_messages_page: messagesPage,
    agent_messages_search: messagesSearch,
    agent_message_origin: messageOrigin,
    agent_rooms_list: roomsList,
    agent_memory_share: memoryShare,
    agent_message_send: messageSend,
    agent_tools_list: toolsList,
    agent_tools_set: toolsSet,
    agent_turn_status: turnStatus,
    agent_turn_cancel: turnCancel,
    agent_attach: attach,
    agent_file_preview: filePreview,
    agent_context_remove_file: contextRemoveFile,
    agent_workspace_set: workspaceSet,
    agent_browser: browserAction,
    agent_profiles_list: profilesList,
    agent_profile_save: profileSave,
    agent_profile_delete: profileDelete,
    agent_template_export: templateExport,
    agent_template_import: templateImport,
    agent_approve: (p) => approve(p, true),
    agent_deny: (p) => approve(p, false),
    agent_effect_undo: effectUndo,
    agent_tasks_list: tasksList,
    agent_tasks_save: tasksSave,
    agent_tasks_cancel: tasksCancel,
    agent_tasks_run: tasksRun,
    agent_tasks_queue: tasksQueue,
    agent_tasks_respond: tasksRespond,
    agent_tasks_verify: tasksVerify,
  },
  _internal: {
    state: () => shared.state,
    shared,
    _providerOverrides: shared.providerOverrides,
  },
};
