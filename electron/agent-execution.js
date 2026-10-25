'use strict';

const crypto = require('node:crypto');

const {
  shared,
  bridge,
  aborted,
  conversation,
  profiles,
  sessions,
  validation,
  sessionForConversation,
  commitSessions,
  requireSession,
  dispatchCallId,
  ctx,
} = require('./agent-shared');
const { compactMessages, requestBudget } = require('./agent-compaction');
const { resolvePortableProfile, mergeProfileSkills, readProfileSkill } = require('./agent-profiles');

const { appendTurn } = require('./turn-log');

const MAX_TOOL_STEPS = 40;
const LIMIT_NOTE = 'Alcancé el límite de pasos de herramienta para este turno. Conservé un punto de continuación; '
  + 'explica lo que queda pendiente y pide usar Reanudar para continuar.';
const MAX_REPEATS = 3;
const PLAN_CHECK_TEXT = 'Tu plan de este encargo aún tiene pasos sin verificar: {steps}. Antes de terminar, sigue con '
  + 'el siguiente y compruébalo; si no puedes completarlo, márcalo como failed en task_plan con la causa y di qué necesitas.';
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;
const SUBAGENT_TOOL = 'subagent_run';
const SUBAGENT_DESCRIPTION_MAX = 80;
const SUBAGENT_MAX_DEPTH = 1;
const SUBAGENT_MAX_TASKS = 4;
const TOOLS_LOAD = 'tools_load';
const CORE_MODULES = new Set(['computer', 'documents', 'drafts', 'agent']);
const CORE_TOOLS = new Set([SUBAGENT_TOOL, TOOLS_LOAD]);
const MAX_LOADED_TOOLS = 25;
const MAX_DEFAULT_TOOLS = 100;

const REASONING_OPENAI_MODEL = /deepseek-(r1|reasoner)|qwq|qwen3|gpt-oss|thinking/i;
const REASONING_ANTHROPIC_MODEL = /claude-(3-7|(opus|sonnet|haiku|fable)-[4-9])/i;
const VISION_MODEL = /gpt-4o|gpt-4\.1|gpt-5|\bo[34]\b|\bo[34]-|claude|gemini|vision|[-_/]vl\b|\bvl[-_]|llava|pixtral|grok-4|llama-4|gemma-3/i;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;

function supportsVision(modelId) {
  return VISION_MODEL.test(String(modelId || ''));
}

function supportsReasoning(style, modelId) {
  return (style === 'anthropic_messages' ? REASONING_ANTHROPIC_MODEL : REASONING_OPENAI_MODEL).test(String(modelId || ''));
}

function thinkingLevelFor(style, modelId) {
  return supportsReasoning(style, modelId) ? 'low' : 'off';
}

async function providerInfo(provider) {
  return bridge('agent_internal_provider', { provider });
}

function sanitizeProviderError(message) {
  let safe = String(message || '');
  for (const record of shared.providers.values()) {
    const info = record.info;
    for (const secret of [info.api_key, ...Object.values(info.extra_headers || {}), ...(record.secrets || [])]) {
      if (typeof secret === 'string' && secret) {
        safe = safe.replaceAll(secret, '<REDACTED>');
        if (secret.toLowerCase().startsWith('bearer ') && secret.length >= 15) safe = safe.replaceAll(secret.slice(7), '<REDACTED>');
      }
    }
  }
  return safe;
}

async function ensureProvider(providerId, modelId) {
  const override = shared.providerOverrides.get(providerId);
  if (override) {
    shared.state.models.setProvider(override);
    return;
  }
  const info = await providerInfo(providerId);
  const existing = shared.providers.get(providerId);
  if (existing && existing.modelIds.has(modelId) && existing.info.base_url === info.base_url
    && JSON.stringify(existing.info.capabilities || {}) === JSON.stringify(info.capabilities || {})
    && shared.state.models.getModel(providerId, modelId)) return;
  const record = existing || { info, modelIds: new Set(), secrets: new Set() };
  record.info = info;
  if (modelId) record.modelIds.add(modelId);
  shared.providers.set(providerId, record);
  shared.state.models.setProvider(await buildProvider(record));
}

// pi-ai trata un host desconocido como la API oficial de OpenAI («store», rol
// «developer», max_completion_tokens); los servidores compatibles (Ollama, LM
// Studio, vLLM, llama.cpp…) esperan el contrato clásico de Chat Completions.
const OPENAI_NATIVE_HOST = /(^|\.)(openai\.com|openrouter\.ai|openai\.azure\.com)$/i;
const LONG_CACHE_HOST = /(^|\.)(openai\.com|openrouter\.ai|anthropic\.com)$/i;

function modelDefinition(info, id, api, verified, catalogModel) {
  const capabilities = info.capabilities || {};
  const catalog = catalogModel || verified || {};
  const contextWindow = Number(capabilities.context_window) || Number(catalog.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  const rates = catalog.cost || {};
  let host = '';
  try { host = new URL(info.base_url).hostname; } catch { }
  const classic = info.custom && api === 'openai-completions' && !OPENAI_NATIVE_HOST.test(host);
  const official = LONG_CACHE_HOST.test(host);
  const flags = official && verified && verified.api === api ? verified.compat || {} : {};
  // Caché del prefijo: la retención larga (1 h / 24 h) solo viaja a las APIs
  // oficiales; los modelos que el catálogo de pi-ai verifica reciben las
  // herramientas nuevas como bloques tool_addition, así tools_load no cambia la
  // lista enviada; y Claude vía OpenRouter lleva marcas cache_control aunque el
  // proveedor sea propio (pi-ai solo las pone al proveedor «openrouter»).
  const compat = {
    ...(official ? {} : { supportsLongCacheRetention: false }),
    ...(flags.supportsMidConvoSystemMessages && flags.supportsMidConvoToolChanges
      ? { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } : {}),
    ...(api === 'openai-completions' && /(^|\.)openrouter\.ai$/i.test(host) && id.startsWith('anthropic/')
      ? { cacheControlFormat: 'anthropic' } : {}),
    ...(classic ? { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } : {}),
  };
  return {
    id,
    name: id,
    api,
    provider: info.provider,
    baseUrl: info.base_url,
    input: (typeof capabilities.vision === 'boolean' ? capabilities.vision : supportsVision(id)) ? ['text', 'image'] : ['text'],
    cost: {
      input: Number(rates.input) || 0,
      output: Number(rates.output) || 0,
      cacheRead: Number(rates.cacheRead) || 0,
      cacheWrite: Number(rates.cacheWrite) || 0,
      ...(Array.isArray(rates.tiers) ? { tiers: rates.tiers } : {}),
    },
    contextWindow,
    maxTokens: Math.min(DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 4)),
    reasoning: supportsReasoning(info.style, id),
    ...(Object.keys(compat).length ? { compat } : {}),
  };
}

const MODEL_CATALOGS = {
  openai: ['@earendil-works/pi-ai/providers/openai.models', 'OPENAI_MODELS'],
  anthropic: ['@earendil-works/pi-ai/providers/anthropic.models', 'ANTHROPIC_MODELS'],
  openrouter: ['@earendil-works/pi-ai/providers/openrouter.models', 'OPENROUTER_MODELS'],
};

async function catalogModels(provider) {
  const entry = MODEL_CATALOGS[provider];
  if (!entry) return {};
  const module = await import(entry[0]);
  return module[entry[1]] || {};
}

async function buildProvider(record) {
  const { createProvider } = await import('@earendil-works/pi-ai');
  const { info, modelIds } = record;
  const anthropic = info.style === 'anthropic_messages';
  const api = anthropic ? 'anthropic-messages' : 'openai-completions';
  const providerId = info.provider;
  const catalog = await catalogModels(providerId);
  return createProvider({
    id: providerId,
    name: providerId,
    baseUrl: info.base_url,
    auth: {
      apiKey: {
        name: `${providerId} API key`,
        resolve: async () => {
          const fresh = await providerInfo(providerId);
          for (const secret of [fresh.api_key, ...Object.values(fresh.extra_headers || {})]) record.secrets.add(secret);
          record.info = fresh;
          return {
            auth: {
              // El SDK OpenAI exige una apiKey no vacía; los proveedores sin
              // auth (Ollama y otros endpoints locales) llevan un placeholder.
              apiKey: fresh.api_key || (fresh.auth_type === 'none' ? 'antares-local' : undefined),
              baseUrl: fresh.base_url || undefined,
              headers: fresh.extra_headers || undefined,
            },
          };
        },
      },
    },
    models: [...modelIds].map((id) => modelDefinition(info, id, api, anthropic ? catalog[id] : undefined, catalog[id])),
    api: anthropic ? shared.deps.aiAnthropic.anthropicMessagesApi() : shared.deps.aiOpenai.openAICompletionsApi(),
  });
}

async function allToolSpecs() {
  const { tools } = await bridge('agent_internal_tools', {});
  const merged = new Map(tools.map((tool) => [tool.name, tool]));
  const scheduleTool = require('./agent-tasks').TOOL;
  merged.set(scheduleTool.name, scheduleTool);
  const eventTool = require('./agent-events').TOOL;
  merged.set(eventTool.name, eventTool);
  for (const tool of nativeTools().nativeToolSpecs()) {
    const current = merged.get(tool.name);
    merged.set(tool.name, { ...current, ...tool, ...(tool.inheritSchema && current ? { inputSchema: current.inputSchema } : {}) });
  }
  const saved = Object.values(await profiles()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (saved.length > 0) {
    const delegateTool = require('./agent-tasks').DELEGATE_TOOL;
    merged.set(delegateTool.name, delegateTool);
    merged.set(SUBAGENT_TOOL, {
      name: SUBAGENT_TOOL,
      description: `Delega trabajo acotado en uno de los agentes guardados del usuario y devuelve el resultado con sus pasos y su rol. `
        + `Por defecto solo lee; role=reviewer pide una revisión y role=worker solo funciona si la ficha del agente tiene ese rol, `
        + `con cada efecto aprobado en esta conversación. Admiten task o hasta ${SUBAGENT_MAX_TASKS} tasks agrupadas. `
        + `output_schema valida la respuesta como JSON Schema. No hay delegación recursiva (profundidad máxima ${SUBAGENT_MAX_DEPTH}). `
        + `Agentes disponibles: ${saved.map((profile) => `«${profile.name}» (${String(profile.description || 'agente personalizado').slice(0, SUBAGENT_DESCRIPTION_MAX)})`).join('; ')}.`,
      gated: false,
      kind: 'subagent',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Identificador del agente mencionado o nombre exacto y único del agente guardado' },
          task: { type: 'string', description: 'Encargo concreto y autocontenido para el subagente' },
          tasks: {
            type: 'array', minItems: 1, maxItems: SUBAGENT_MAX_TASKS,
            description: 'Encargos que se ejecutan en orden y se devuelven agrupados; no lo combines con task',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'Encargo concreto y autocontenido' },
                role: { type: 'string', enum: ['explorer', 'reviewer', 'worker'] },
                exclude_tools: { type: 'array', items: { type: 'string' }, description: 'Herramientas que este encargo no debe usar' },
                output_schema: { type: 'object', description: 'JSON Schema que debe cumplir la respuesta' },
              },
              required: ['task'],
            },
          },
          role: { type: 'string', enum: ['explorer', 'reviewer', 'worker'], description: 'Rol del encargo; worker requiere que la ficha lo permita' },
          exclude_tools: { type: 'array', items: { type: 'string' }, description: 'Sustrae herramientas de las que permite la ficha' },
          output_schema: { type: 'object', description: 'JSON Schema que debe cumplir la respuesta final' },
        },
        required: ['agent'],
      },
    });
  } else {
    merged.delete(SUBAGENT_TOOL);
    merged.delete('agent_delegate');
  }
  merged.set(TOOLS_LOAD, {
    name: TOOLS_LOAD,
    description: 'Catálogo · tools_load (sin efectos): busca herramientas de Antares que aún no tienes por texto o por módulo y '
      + 'las habilita desde la siguiente ronda. Sin argumentos lista los módulos disponibles. Úsala cuando el encargo '
      + 'necesite un módulo de Antares (reportes, Canvas, AutoIMG, Espacios, conexiones, MCP…).',
    gated: false,
    kind: 'meta',
    module: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué necesitas hacer o el nombre aproximado de la herramienta' },
        modules: { type: 'array', items: { type: 'string' }, description: 'Módulos cuyas herramientas quieres cargar' },
      },
    },
  });
  merged.set('sessions_search', {
    name: 'sessions_search',
    description: 'Busca texto en conversaciones locales anteriores y devuelve fragmentos con su conversación y mensaje de origen. '
      + 'No busca razonamiento ni resultados de herramientas. Usa session_id para limitar la búsqueda a una conversación.',
    gated: false,
    kind: 'meta',
    module: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        session_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  });
  return [...merged.values()];
}

async function searchSessions(args, currentSessionId, context) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query || query.length > 200) throw validation('Indica un texto de búsqueda de hasta 200 caracteres');
  const limit = args.limit === undefined ? 5 : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw validation('El límite debe estar entre 1 y 10');
  if (args.session_id !== undefined && typeof args.session_id !== 'string') throw validation('Indica una conversación válida');
  const words = normal(query).split(/\s+/);
  const candidates = Object.values(await sessions())
    .filter((session) => !session.deleted && (args.session_id ? session.id === args.session_id : session.id !== currentSessionId))
    .sort((first, second) => (second.updated_at || 0) - (first.updated_at || 0));
  const matches = [];
  let searched = 0;
  let truncated = false;
  for (const session of candidates) {
    if (context?.abortSignal?.aborted) throw aborted();
    const conv = await shared.state.harness.conversation(session.conversationId, context);
    if (!conv) continue;
    searched += 1;
    let cursor;
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      if (context?.abortSignal?.aborted) throw aborted();
      const page = await conv.entries({}, 500, cursor, context);
      for (const entry of page.items) {
        if (!['pi.user', 'pi.assistant'].includes(entry.kind)) continue;
        const message = entry.model && entry.model[0];
        if (!message) continue;
        const text = typeof message.content === 'string' ? message.content : (message.content || [])
          .filter((block) => block.type === 'text' && !String(block.text || '').startsWith(shared.CONTEXT_MARKER))
          .map((block) => block.text || '').join('');
        if (text.startsWith(shared.CHECK_MARKER)) continue;
        const safe = sanitizeProviderError(text);
        const normalized = normal(safe);
        if (!words.every((word) => normalized.includes(word))) continue;
        const start = Math.max(0, normalized.indexOf(words[0]) - 80);
        matches.push({
          session_id: session.id, title: session.title, message_id: entry.id,
          role: message.role, ts: message.timestamp || 0,
          excerpt: `${start ? '…' : ''}${safe.slice(start, start + 300)}${safe.length > start + 300 ? '…' : ''}`,
        });
        if (matches.length >= limit) return { matches, searched_sessions: searched, truncated: true };
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    if (cursor) truncated = true;
  }
  return { matches, searched_sessions: searched, truncated };
}

function defaultToolNames(specs) {
  if (specs.length <= MAX_DEFAULT_TOOLS) return null;
  return specs.filter((spec) => CORE_MODULES.has(spec.module) || CORE_TOOLS.has(spec.name)).map((spec) => spec.name);
}

function moduleToolNames(modules) {
  const wanted = new Set(modules);
  return [...shared.toolSpecs.values()].filter((spec) => wanted.has(spec.module)).map((spec) => spec.name);
}

function normal(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function loadTools(args, sessionId, context) {
  const conv = await conversation(sessionId);
  const enabled = new Set((await conv.agent(context)).tools.map((tool) => tool.name));
  const specs = [...shared.toolSpecs.values()].filter((spec) => spec.kind !== 'meta'
    || ['task_schedule', 'agent_delegate', 'wait_event'].includes(spec.name));
  const modules = Array.isArray(args.modules) ? args.modules.map(String) : [];
  const words = normal(args.query).split(/[^a-z0-9_]+/).filter((word) => word.length > 2);
  if (!modules.length && !words.length) {
    const catalog = new Map();
    for (const spec of specs) {
      const id = spec.module || 'otros';
      const item = catalog.get(id) || { module: id, tools: 0, loaded: 0 };
      item.tools += 1;
      if (enabled.has(spec.name)) item.loaded += 1;
      catalog.set(id, item);
    }
    return { text: JSON.stringify({ modules: [...catalog.values()].sort((a, b) => a.module.localeCompare(b.module)) }) };
  }
  const score = (spec) => {
    if (modules.includes(spec.module)) return 100;
    const haystack = normal(`${spec.name} ${spec.module || ''} ${spec.label || ''} ${spec.description || ''}`);
    return words.filter((word) => haystack.includes(word)).length;
  };
  const found = specs.map((spec) => [spec, score(spec)]).filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_LOADED_TOOLS).map(([spec]) => spec);
  const added = found.filter((spec) => !enabled.has(spec.name)).map((spec) => spec.name);
  const text = JSON.stringify({
    loaded: added,
    already_enabled: found.filter((spec) => enabled.has(spec.name)).map((spec) => spec.name),
    tools: found.map((spec) => ({ name: spec.name, module: spec.module || null, gated: !!spec.gated,
      description: String(spec.description || '').slice(0, 160) })),
    ...(found.length ? {} : { note: 'Sin coincidencias; llama a tools_load sin argumentos para ver los módulos' }),
  });
  return { text, added };
}

async function resolveProfile(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const saved = Object.values(await profiles());
  const exact = saved.find((profile) => profile.id === wanted);
  const matches = saved.filter((profile) => String(profile.name || '').trim().toLowerCase() === wanted.toLowerCase());
  return exact || (matches.length === 1 ? matches[0] : null);
}

function nativeTools() {
  return shared.nativeTools || require('./agent-native-tools');
}

async function refreshTools() {
  const { pi } = shared.deps;
  const tools = await allToolSpecs();
  shared.toolSpecs.clear();
  const registrations = tools.map((spec) => {
    shared.toolSpecs.set(spec.name, spec);
    return pi.defineTool({
      name: spec.name,
      description: String(spec.description || spec.name),
      parameters: spec.inputSchema && typeof spec.inputSchema === 'object'
        ? spec.inputSchema
        : { type: 'object', properties: {} },
      replay: spec.replay_safe === true ? 'safe' : 'unsafe',
      execute: (args, api, context) => executeTool(spec, args, api, context),
    });
  });
  shared.state.registry.install(pi.defineExtension({
    name: 'antares.agent',
    tools: registrations,
    hooks: [
      pi.hook(pi.ToolTask, { beforeTool }),
      pi.hook(pi.GenerationTask, {
        beforeRequest: async ({ messages }, api, context) => {
          resolvePortableProfile(shared.state.portableProfiles, api.conversationId);
          if (await toolBudget(api, context) >= MAX_TOOL_STEPS) await pauseForBudget(api, context);
          await noteTurnStart(api, messages || []);
          const compacted = await compactRequest(messages, api, context);
          const next = compacted || messages;
          return leadingSystem(next) || (compacted ? { messages: next } : undefined);
        },
        afterTools: (_output, _task, api, context) => countRound(api, context),
        onYield: (answer, api) => planCheck(answer, api),
        afterResponse: async (message, api, context) => {
          try {
            if (message.stopReason === 'aborted') return;
            if (message.errorMessage) message.errorMessage = sanitizeProviderError(message.errorMessage);
            const sessionId = await sessionForConversation(api.conversationId, api, context);
            await commitSessions((sessions) => {
              if (sessions[sessionId]) sessions[sessionId].last_error = message.errorMessage ? message.errorMessage.slice(0, 300) : null;
              if (sessions[sessionId] && !message.errorMessage && message.stopReason === 'stop'
                && (shared.rounds.get(api.conversationId) || 0) < MAX_TOOL_STEPS) delete sessions[sessionId].continuation;
            });
          } finally {
            await closeTurnLog(message, api);
          }
        },
      }),
    ],
  }));
}

let tokenEstimator;

async function compactRequest(messages, api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const session = sessionId ? (await sessions())[sessionId] : null;
  const model = session && shared.state.models.getModel(session.provider, session.model);
  const budget = requestBudget(model && model.contextWindow, model && model.maxTokens);
  if (!budget) return undefined;
  tokenEstimator ||= (await import('@earendil-works/pi-ai/utils/estimate')).estimateContextTokens;
  return compactMessages(messages, { budget, estimate: (list) => tokenEstimator(list).tokens });
}

// pi-durable escribe el prompt base al preparar la primera generación, detrás
// del mensaje que la provocó. Los modelos que aceptan mensajes de sistema a
// mitad de conversación lo enviarían como una actualización y sin herramientas
// iniciales; al encabezar la petición vuelve a ser el prompt de sistema y el
// ancla fija de la lista de herramientas. Al resto no le cambia nada: pi-ai ya
// reúne sus mensajes de sistema al principio.
function leadingSystem(messages) {
  const index = messages.findIndex((message) => message.role === 'system');
  if (index <= 0) return undefined;
  return { messages: [messages[index], ...messages.slice(0, index), ...messages.slice(index + 1)] };
}

async function countRound(api, context) {
  if (await toolBudget(api, context, true) >= MAX_TOOL_STEPS) await pauseForBudget(api, context);
}

async function toolBudget(api, context, completed = false) {
  const { harness, BudgetDoc } = shared.state;
  const rounds = await harness.commit(async (tx) => {
    const live = await tx.doc(shared.deps.pi.LiveDoc, api.conversationId);
    const budget = await tx.doc(BudgetDoc, api.conversationId);
    const run = live.run?.inputs[0];
    if (budget.run !== run) {
      budget.run = run;
      budget.rounds = 0;
      delete budget.lastRound;
    }
    if (completed && budget.lastRound !== api.taskId) {
      budget.rounds += 1;
      budget.lastRound = api.taskId;
    }
    return budget.rounds;
  }, context);
  shared.rounds.set(api.conversationId, rounds);
  return rounds;
}

async function pauseForBudget(api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const remaining = turnState(api.conversationId).remaining || [];
  await commitSessions((map) => {
    if (map[sessionId]) map[sessionId].continuation = {
      reason: 'tool_budget', rounds: MAX_TOOL_STEPS, pending_steps: remaining, created_at: Date.now(),
    };
  });
  const conv = await conversation(sessionId);
  const stopped = shared.state.harness.abortTask(api.taskId, ctx()).then(async () => {
    await conv.waitForIdle(ctx());
    return conv.submit({ type: 'write', requestId: `budget:${api.taskId}`, entry: {
      kind: shared.NOTICE_KIND, data: { text: 'Este turno alcanzó su límite de pasos. Conservé un punto de continuación. '
        + `Usa Reanudar para seguir.${remaining.length ? '\nPendiente: ' + remaining.join('; ') : ''}` },
    } }, ctx());
  });
  // El aborto debe interrumpir esta espera: abortTask espera a que termine este mismo hook.
  try {
    await shared.deps.chord.awaitWithContext(stopped, context);
  } finally {
    // El aborto no despacha afterResponse (pi-durable cierra el run antes): sin este
    // cierre se perdería la entrada «failed» y el log abierto pasaría al turno siguiente.
    await closeTurnLog({ stopReason: 'aborted', errorMessage: null, content: [] }, api);
  }
}

function turnState(conversationId) {
  let turn = shared.turns.get(conversationId);
  if (!turn) {
    turn = { calls: new Map(), remaining: null, checked: false };
    shared.turns.set(conversationId, turn);
  }
  return turn;
}

const TURN_SUMMARY_CHARS = 300;

function boundedSummary(value) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  return collapsed.length > TURN_SUMMARY_CHARS ? `${collapsed.slice(0, TURN_SUMMARY_CHARS)}...` : collapsed;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part && part.type === 'text').map((part) => part.text).join(' ');
  }
  return '';
}

function noteTurnStart(api, messages) {
  return (async () => {
    const turn = turnState(api.conversationId);
    if (turn.log) return;
    const sessionId = await sessionForConversation(api.conversationId, api, null) || '';
    let agent = '';
    try {
      const session = sessionId ? await requireSession(sessionId) : null;
      agent = session ? `${session.provider || ''}/${session.model || ''}` : '';
    } catch { }
    turn.log = {
      turn_id: `turn_${crypto.randomUUID()}`,
      session_id: sessionId,
      agent,
      started_at: new Date().toISOString(),
      input_summary: boundedSummary(messageText(lastUserContent(messages))),
      tool_calls: [],
    };
  })().catch((err) => {
    console.error('[agent] registro de turnos: inicio no registrado:', (err && err.message) || err);
  });
}

function lastUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

function noteToolResult(api, name, text, isError) {
  try {
    const turn = shared.turns.get(api.conversationId);
    if (!turn || !turn.log) return;
    turn.log.tool_calls.push({
      name: String(name || ''),
      applied: !isError,
      verified: { kind: 'capture', value: boundedSummary(text) },
    });
  } catch (err) {
    console.error('[agent] registro de turnos: llamada no registrada:', (err && err.message) || err);
  }
}

// Cada segmento (turno, continuación de plan-check, reanudación) es una entrada propia:
// fusionarlas exigiría retrasar la escritura y perder segmentos previos si el proceso muere.
async function closeTurnLog(message, api) {
  const turn = shared.turns.get(api.conversationId);
  const record = turn && turn.log;
  if (!record) return;
  const stopReason = message && message.stopReason;
  if (stopReason !== 'stop' && stopReason !== 'error' && stopReason !== 'aborted' && stopReason !== 'length') return;
  turn.log = null;
  const error = message && message.errorMessage ? String(message.errorMessage) : null;
  try {
    appendTurn({
      turn_id: record.turn_id,
      session_id: record.session_id,
      agent: record.agent || '',
      started_at: record.started_at,
      ended_at: new Date().toISOString(),
      status: stopReason === 'stop' && !error ? 'ok' : stopReason === 'aborted' ? 'failed' : 'error',
      tool_calls: record.tool_calls,
      input_summary: record.input_summary || '',
      output_summary: boundedSummary(messageText(message && message.content)),
      error: stopReason === 'length' && !error ? 'respuesta truncada por límite de longitud' : error,
    });
  } catch (err) {
    console.error('[agent] registro de turnos: no se pudo escribir', record.turn_id, ':', (err && err.message) || err);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function planCheck(answer, api) {
  const turn = shared.turns.get(api.conversationId);
  if (!turn || turn.checked || !turn.remaining || !turn.remaining.length) return undefined;
  if (answer.errorMessage || answer.stopReason === 'aborted' || answer.stopReason === 'error') return undefined;
  if ((shared.rounds.get(api.conversationId) || 0) >= MAX_TOOL_STEPS) return undefined;
  turn.checked = true;
  const steps = turn.remaining.map((title) => `«${title}»`).join(', ');
  return { continue: `${shared.CHECK_MARKER} ${PLAN_CHECK_TEXT.replace('{steps}', steps)}` };
}

// El backend exige una aprobación aprobada para despachar gated: "permitir
// siempre" se resuelve aprobándola sola, como el modo completo.
function webAlwaysAllowed(name, context) {
  if (!String(name || '').startsWith('web_') || !context || context.policy_blocked) return false;
  const domain = String(context.domain || '');
  return !!domain && require('./agent-browser-policy').isAlwaysAllowed(domain);
}

async function beforeTool(call, api, context) {
  const spec = shared.toolSpecs.get(call.name);
  const rounds = await toolBudget(api, context);
  if (rounds >= MAX_TOOL_STEPS) return { block: LIMIT_NOTE };
  if (!spec) return { block: `Herramienta no disponible para el agente: ${call.name}` };
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, call.name, context)) return { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
  const calls = turnState(api.conversationId).calls;
  const signature = `${call.name}:${stableJson(call.arguments || {})}`;
  const repeated = calls.get(signature) || { count: 0 };
  repeated.count += 1;
  calls.set(signature, repeated);
  if (repeated.count > MAX_REPEATS) {
    return { block: `Ya llamaste a ${call.name} ${MAX_REPEATS} veces en este turno con los mismos argumentos. No lo repitas: `
      + 'cambia de enfoque o informa al usuario de qué te bloquea, qué comprobaste y qué necesitas.' };
  }
  const session = await requireSession(sessionId);
  if (session.delegation && (spec.kind !== 'backend' || spec.replay_safe !== true)) {
    return { block: 'El agente delegado solo puede usar lecturas idempotentes autorizadas' };
  }
  const mode = session.permission_mode || 'auto';
  if (!spec.gated && !(mode === 'ask' && call.name.startsWith('web_'))) return undefined;

  const callId = dispatchCallId(call.id, api.taskId);
  let approval;
  try {
    const approvedContext = spec.kind === 'native' ? await nativeTools().nativeToolContext(spec.name) : undefined;
    ({ approval } = await bridge('agent_internal_approval_ensure', {
      session_id: sessionId,
      call_id: callId,
      method: call.name,
      params: call.arguments || {},
      ...(approvedContext ? { context: approvedContext } : {}),
    }));
    if (approval.status === 'pending'
      && ((mode === 'full' && !['shell_run', 'shell_job_start'].includes(call.name)) || webAlwaysAllowed(call.name, approvedContext))) {
      ({ approval } = await bridge('agent_internal_approval_decide', { approval_id: approval.id, approve: true }));
    }
  } catch (err) {
    return { block: String((err && err.message) || err) };
  }
  shared.approvalsByCall.set(callKey(sessionId, callId), approval.id);
  shared.liveApprovals.add(approval.id);
  require('./agent-projection').notifyChanged(api.conversationId);
  try {
    let current = approval;
    while (current && current.status === 'pending') {
      await waitForDecision(current.id, context);
      if (context && context.abortSignal && context.abortSignal.aborted) throw aborted();
      const next = (await bridge('agent_internal_approval_status', { approval_id: current.id })).approval;
      current = next || { status: 'expired' };
    }
    if (current.status === 'approved') {
      return await toolEnabled(sessionId, call.name, context) ? undefined
        : { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
    }
    if (current.status === 'denied') return { block: 'El usuario rechazó esta acción' };
    return { block: 'La aprobación expiró; vuelve a pedírselo al agente' };
  } finally {
    shared.liveApprovals.delete(approval.id);
  }
}

function callKey(sessionId, callId) {
  return `${sessionId}:${callId}`;
}

function waitForDecision(approvalId, context) {
  const signal = context && context.abortSignal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    let waiters = shared.decisionWaiters.get(approvalId);
    if (!waiters) {
      waiters = new Set();
      shared.decisionWaiters.set(approvalId, waiters);
    }
    const timer = setTimeout(() => done(), 1500);
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      if (!waiters.size) shared.decisionWaiters.delete(approvalId);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      waiters.delete(done);
      if (!waiters.size) shared.decisionWaiters.delete(approvalId);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(aborted());
    };
    waiters.add(done);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function notifyDecision(approvalId) {
  const waiters = shared.decisionWaiters.get(approvalId);
  if (!waiters) return;
  for (const resolve of [...waiters]) resolve();
}

async function dispatchAndWait(request, context, api) {
  const signal = context && context.abortSignal;
  if (signal && signal.aborted) throw aborted();
  const first = await bridge('agent_internal_dispatch', request);
  if (signal && signal.aborted) {
    bridge('agent_internal_dispatch_cancel', { session_id: request.session_id, call_id: request.call_id }).catch(() => {});
    throw aborted();
  }
  let result = first.result;
  let shown = 0;
  const onOutput = (output) => {
    if (!api || output.length <= shown) return;
    api.output(output.slice(shown));
    shown = output.length;
  };
  if (result === null || result === undefined) {
    result = await pollDispatch(request.session_id, request.call_id, context, onOutput);
  }
  return String(result);
}

async function executeTool(spec, args, api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, spec.name, context)) {
    const text = `Herramienta deshabilitada en esta conversación: ${spec.name}`;
    noteToolResult(api, spec.name, text, true);
    return { content: [{ type: 'text', text }], isError: true };
  }
  let text;
  let added;
  try {
    ({ text, added } = await dispatchTool(spec, args, sessionId, api, context));
  } catch (err) {
    noteToolResult(api, spec.name, `error: ${(err && err.message) || err}`, true);
    throw err;
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { }
  const isError = !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
  if (spec.name === 'task_plan' && !isError && parsed && Array.isArray(parsed.remaining)) {
    turnState(api.conversationId).remaining = parsed.remaining.map(String);
  }
  const image = isError || !await acceptsImages(api, context) ? null : await resultImage(parsed);
  if (!isError && (!spec.gated || spec.name === 'desktop_observe')) {
    const repeated = turnState(api.conversationId).calls.get(`${spec.name}:${stableJson(args || {})}`);
    if (repeated) {
      let outcome = stableJson(parsed ?? text);
      const capture = parsed && (parsed.image || (parsed.observation && parsed.observation.image));
      if (capture && typeof capture.path === 'string') {
        const fingerprint = image ? crypto.createHash('sha256').update(image.data).digest('hex') : 'captura';
        outcome = outcome.replaceAll(JSON.stringify(capture.path), JSON.stringify(fingerprint));
      }
      if (repeated.result !== undefined && repeated.result !== outcome) repeated.count = 1;
      repeated.result = outcome;
    }
  }
  noteToolResult(api, spec.name, text, isError);
  return { content: [{ type: 'text', text }, ...(image ? [image] : [])], isError,
    ...(added && added.length ? { control: { addTools: added } } : {}) };
}

async function dispatchTool(spec, args, sessionId, api, context) {
  const portableProfile = resolvePortableProfile(shared.state.portableProfiles, api.conversationId);
  if (portableProfile && spec.name === 'skills_read' && typeof args?.skill_id === 'string' && args.skill_id.startsWith('profile:')) {
    return { text: JSON.stringify(readProfileSkill(portableProfile, args)) };
  }
  if (spec.kind === 'meta') {
    if (spec.name === 'agent_delegate') {
      const profile = await resolveProfile(args?.agent);
      if (!profile) throw validation('No se encontró un agente único; usa su identificador');
      return { text: JSON.stringify(await require('./agent-tasks').delegate(profile, args, sessionId, api, context)) };
    }
    if (spec.name === 'task_schedule') return { text: JSON.stringify(await require('./agent-tasks').schedule(args || {}, sessionId, api)) };
    if (spec.name === 'wait_event') return { text: JSON.stringify(await require('./agent-events').wait(args || {}, sessionId, api, context)) };
    if (spec.name === 'sessions_search') return { text: JSON.stringify(await searchSessions(args || {}, sessionId, context)) };
    return loadTools(args || {}, sessionId, context);
  }
  const callId = dispatchCallId(api.callId, api.taskId);
  const approvalId = shared.approvalsByCall.get(callKey(sessionId, callId));
  const request = {
    session_id: sessionId,
    call_id: callId,
    name: spec.name,
    params: args || {},
    approval_id: approvalId,
    ...(spec.kind === 'native' ? { context: await nativeTools().nativeToolContext(spec.name) } : {}),
  };
  if (spec.name === 'skills_list' || spec.name === 'skills_read') {
    request.context = { profile_id: (await requireSession(sessionId)).profile?.id || null };
  }
  if (spec.kind === 'subagent') {
    const profile = await resolveProfile(args && args.agent);
    if (!profile) return { text: JSON.stringify({ error: 'No se encontró un agente único con esa referencia; usa el identificador de un bot disponible' }) };
    const conv = await conversation(sessionId);
    const enabled = (await conv.agent(context)).tools.map((tool) => tool.name);
    const session = await requireSession(sessionId);
    request.context = {
      subagent: {
        id: profile.id,
        name: profile.name,
        role: profile.role || 'explorer',
        instructions: profile.instructions,
        tools: Array.isArray(profile.tools) ? profile.tools : null,
        enabled,
        provider: session.provider,
        model: session.model,
      },
    };
  }
  if (spec.name === 'ask_user') shared.waitingInput.add(sessionId);
  try {
    const text = spec.kind === 'native'
      ? await dispatchNative(spec, request, context)
      : await dispatchAndWait(request, context, api);
    return { text: portableProfile && spec.name === 'skills_list' ? mergeProfileSkills(portableProfile, args, text) : text };
  } finally {
    if (spec.name === 'ask_user') shared.waitingInput.delete(sessionId);
  }
}

// Sin visión, pi-ai sustituye la imagen por un aviso pegado al texto del
// resultado; no adjuntarla mantiene el JSON íntegro para el modelo.
async function acceptsImages(api, context) {
  const ref = (await api.agent(context)).model;
  const model = ref && shared.state.models.getModel(ref.provider, ref.modelId);
  return !!(model && model.input.includes('image'));
}

async function resultImage(parsed) {
  const ref = parsed && (parsed.image || (parsed.observation && parsed.observation.image));
  if (!ref || typeof ref.path !== 'string' || ref.mime !== 'image/jpeg') return null;
  const fs = require('node:fs');
  const path = require('node:path');
  const { antaresUserData } = require('./canvas-assets');
  const root = path.resolve(antaresUserData('ai-agent', 'drafts'));
  const target = path.resolve(ref.path);
  if (!target.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) return null;
  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    return { type: 'image', data: (await fs.promises.readFile(target)).toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

async function dispatchNative(spec, request, context) {
  let first = await bridge('agent_internal_dispatch', { ...request, native: true, gated: !!spec.gated });
  while (first.busy) {
    await waitResource(context);
    if (!await toolEnabled(request.session_id, spec.name, context)) {
      return JSON.stringify({ error: `Herramienta deshabilitada en esta conversación: ${spec.name}` });
    }
    request.context = await nativeTools().nativeToolContext(spec.name);
    first = await bridge('agent_internal_dispatch', { ...request, native: true, gated: !!spec.gated });
  }
  if (first.execute !== 'native') {
    let result = first.result;
    if (result === null || result === undefined) {
      result = await pollDispatch(request.session_id, request.call_id, context);
    }
    return String(result);
  }
  let text;
  let uncertain = false;
  try {
    if (!await toolEnabled(request.session_id, spec.name, context)) {
      throw new Error(`Herramienta deshabilitada en esta conversación: ${spec.name}`);
    }
    const result = await nativeTools().runNativeTool(spec.name, request.params, {
      sessionId: request.session_id, approvedContext: request.context,
    });
    text = JSON.stringify(result === undefined ? null : result);
  } catch (err) {
    uncertain = err?.uncertain === true;
    text = JSON.stringify({ error: String((err && err.message) || err).slice(0, 500), ...(uncertain ? { interrupted: true, uncertain: true } : {}) });
  }
  const finished = await bridge('agent_internal_dispatch_finish', {
    session_id: request.session_id,
    call_id: request.call_id,
    op_id: first.dispatch.op_id,
    result: text,
    uncertain,
  });
  return String(finished.result);
}

async function dispatchApproved(approval, context) {
  try {
    const spec = (await allToolSpecs()).find((tool) => tool.name === approval.method);
    if (!spec) return JSON.stringify({ error: 'La herramienta aprobada ya no está disponible' });
    if (!await toolEnabled(approval.session_id, spec.name, context)) {
      return JSON.stringify({ error: `Herramienta deshabilitada en esta conversación: ${spec.name}` });
    }
    const request = {
      session_id: approval.session_id, call_id: approval.call_id, name: approval.method,
      params: approval.params || {}, approval_id: approval.id,
    };
    if (spec.kind === 'native') {
      request.context = await nativeTools().nativeToolContext(spec.name);
      return dispatchNative(spec, request, context);
    }
    return dispatchAndWait(request, context);
  } catch (err) {
    return JSON.stringify({ error: String((err && err.message) || err).slice(0, 500) });
  }
}

async function toolEnabled(sessionId, name, context) {
  const conv = await conversation(sessionId);
  return (await conv.agent(context)).tools.some((tool) => tool.name === name);
}

function waitResource(context) {
  const signal = context && context.abortSignal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, 400);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function pollDispatch(sessionId, callId, context, onOutput) {
  const signal = context && context.abortSignal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    let settled = false;
    let timer;
    const done = (error, result) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
      return true;
    };
    const onAbort = () => {
      if (done(aborted())) {
        bridge('agent_internal_dispatch_cancel', { session_id: sessionId, call_id: callId }).catch(() => {});
      }
    };
    const poll = async () => {
      if (settled) return;
      try {
        const next = await bridge('agent_internal_dispatch_result', { session_id: sessionId, call_id: callId });
        if (settled) return;
        if (onOutput && typeof next.output === 'string') onOutput(next.output);
        if (settled) return;
        if (next.result === null || next.result === undefined) timer = setTimeout(poll, 400);
        else done(null, next.result);
      } catch (err) {
        done(null, INTERRUPTED_RESULT);
      }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(poll, 400);
  });
}

module.exports = {
  allToolSpecs,
  defaultToolNames,
  moduleToolNames,
  TOOLS_LOAD,
  supportsVision,
  modelDefinition,
  leadingSystem,
  callKey,
  providerInfo,
  thinkingLevelFor,
  ensureProvider,
  refreshTools,
  notifyDecision,
  dispatchApproved,
  sanitizeProviderError,
};
