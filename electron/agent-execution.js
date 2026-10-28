'use strict';

const crypto = require('node:crypto');
const { channelFor, channelLabel } = require('./agent-channels');

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
  providerCallId,
  dispatchTaskId,
  ctx,
} = require('./agent-shared');
const { compactMessages, requestBudget } = require('./agent-request-budget');
const { resolvePortableProfile } = require('./agent-profiles');

const compaction = require('./agent-compaction');

const { appendTurn } = require('./turn-log');

const MAX_TOOL_STEPS = 40;
const LIMIT_NOTE = 'Alcancé el límite de pasos de herramienta para este turno. Conservé un punto de continuación; '
  + 'explica lo que queda pendiente y pide usar Reanudar para continuar.';
const BUDGET_WARNING_STEPS = 32;
const MAX_REPEATS = 3;
const MAX_RECOVERABLE_FAILURES = 6;
const MAX_RETRY_AFTER_MS = 30_000;
const PLAN_CHECK_TEXT = 'Tu plan de este encargo aún tiene pasos sin verificar: {steps}. Antes de terminar, sigue con '
  + 'el siguiente y compruébalo; si no puedes completarlo, márcalo como failed en task_plan con la causa y di qué necesitas.';
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;
const SUBAGENT_TOOL = 'subagent_run';
const SUBAGENT_DESCRIPTION_MAX = 80;
const SUBAGENT_MAX_DEPTH = 1;
const SUBAGENT_MAX_TASKS = 4;
const TOOLS_LOAD = 'tools_load';
const requiredSkills = new Map();
const CORE_MODULES = new Set(['computer', 'documents', 'drafts', 'agent']);
const CORE_TOOLS = new Set([SUBAGENT_TOOL, TOOLS_LOAD, 'task_schedule']);
const MEMORY_TOOLS = ['memory_search', 'memory_remember', 'procedure_learn'];
const UI_ACTION_TOOLS = new Set(['cua_click', 'cua_drag', 'cua_scroll', 'cua_type_text', 'cua_press_key', 'cua_hotkey',
  'cua_set_value', 'cua_invoke_menu', 'cua_bring_to_front']);
const DESKTOP_ACTION_TOOLS = new Set(['desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll',
  'desktop_launch', 'desktop_focus']);
const NEVER_AUTO_APPROVE = new Set(['shell_run', 'shell_job_start', 'cua_launch_app', ...UI_ACTION_TOOLS, ...DESKTOP_ACTION_TOOLS]);
const SHELL_TOOLS = new Set(['shell_run', 'shell_job_start']);
const DESTRUCTIVE_COMMAND = new RegExp(String.raw`(?:^\s*|[;|&({]\s*)(?:remove-item|rm|ri|del|erase|rd|rmdir|clear-content|format-volume|clear-disk)\b`
  + String.raw`|\bformat(?:\.com)?\s+[a-z]:|\bgit\s+(?:clean\b|reset\s+--hard\b|checkout\s+--\s)|\[(?:system\.)?io\.(?:file|directory)\]::delete\b`, 'im');
const UNATTENDED_ACTION_TOOLS = new Set(['cua_launch_app', ...UI_ACTION_TOOLS]);
const MAX_UNATTENDED_ACTIONS = 25;
const MAX_LOADED_TOOLS = 25;
// Herramientas meta que un agente delegado conserva aunque no sean lecturas:
// solo hablan con su conversación principal (aviso intermedio y salas).
const CHILD_CONTROL_TOOLS = new Set(['agent_wake_parent', 'agent_room']);
const MAX_DEFAULT_TOOLS = 100;
const MAX_OPENAI_TOOLS = 128;

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

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

async function reasoningLevels(providerId, modelId) {
  const model = shared.state.models.getModel(providerId, modelId);
  if (!model) return [];
  const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai');
  return getSupportedThinkingLevels(model).filter((level) => REASONING_EFFORTS.includes(level));
}

function thinkingLevelFor(levels, effort) {
  if (!levels.length) return 'off';
  const wanted = REASONING_EFFORTS.indexOf(REASONING_EFFORTS.includes(effort) ? effort : 'low');
  return levels.filter((level) => REASONING_EFFORTS.indexOf(level) <= wanted).at(-1) ?? levels[0];
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
    ...(flags.forceAdaptiveThinking ? { forceAdaptiveThinking: true } : {}),
  };
  const reasoning = typeof capabilities.reasoning === 'boolean' ? capabilities.reasoning
    : typeof catalog.reasoning === 'boolean' ? catalog.reasoning : supportsReasoning(info.style, id);
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
    // El techo de salida del catálogo: el razonamiento comparte max_tokens con
    // la respuesta y con 8 k un nivel alto dejaba la respuesta truncada.
    maxTokens: Math.min(Number(catalog.maxTokens) || DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 4)),
    reasoning,
    ...(reasoning && catalog.thinkingLevelMap ? { thinkingLevelMap: catalog.thinkingLevelMap } : {}),
    ...(Object.keys(compat).length ? { compat } : {}),
  };
}

const MODEL_CATALOGS = {
  openai: ['@earendil-works/pi-ai/providers/openai.models', 'OPENAI_MODELS'],
  anthropic: ['@earendil-works/pi-ai/providers/anthropic.models', 'ANTHROPIC_MODELS'],
  openrouter: ['@earendil-works/pi-ai/providers/openrouter.models', 'OPENROUTER_MODELS'],
};

const CATALOG_HOSTS = [
  ['anthropic', 'anthropic_messages', /(^|\.)api\.anthropic\.com$/i],
  ['openai', 'openai_chat', /(^|\.)api\.openai\.com$/i],
  ['openrouter', 'openai_chat', /(^|\.)openrouter\.ai$/i],
];

function catalogFor(info) {
  if (MODEL_CATALOGS[info.provider]) return info.provider;
  let host = '';
  try { host = new URL(info.base_url).hostname; } catch { }
  const match = CATALOG_HOSTS.find(([, style, pattern]) => style === info.style && pattern.test(host));
  return match ? match[0] : null;
}

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
  const catalog = await catalogModels(catalogFor(info));
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
    api: anthropic ? shared.deps.aiAnthropic.anthropicMessagesApi() : cappedOpenAIApi(shared.deps.aiOpenai.openAICompletionsApi()),
  });
}

function capOpenAITools(payload) {
  const tools = payload && payload.tools;
  if (!Array.isArray(tools) || tools.length <= MAX_OPENAI_TOOLS) return payload;
  const nameOf = (tool) => ((tool && (tool.function || tool.custom)) || {}).name;
  const called = new Set((payload.messages || []).flatMap((message) => (message.tool_calls || []).map(nameOf)));
  const rank = (tool) => (called.has(nameOf(tool)) ? 0 : shared.toolSpecs.get(nameOf(tool))?.gated ? 2 : 1);
  const kept = new Set(tools.map((tool, index) => [rank(tool), index])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, MAX_OPENAI_TOOLS)
    .map(([, index]) => index));
  return { ...payload, tools: tools.filter((_, index) => kept.has(index)) };
}

function cappedOpenAIApi(api) {
  const wrap = (stream) => (model, context, options) => stream(model, context, {
    ...options,
    onPayload: async (payload, target) => {
      const next = options && options.onPayload ? await options.onPayload(payload, target) : undefined;
      return capOpenAITools(next === undefined ? payload : next);
    },
  });
  return { ...api, stream: wrap(api.stream), streamSimple: wrap(api.streamSimple) };
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
    const tasks = require('./agent-tasks');
    for (const tool of [tasks.DELEGATE_TOOL, tasks.CHECK_TOOL, tasks.MESSAGE_TOOL, tasks.STOP_TOOL, tasks.WAKE_TOOL,
      require('./agent-rooms').TOOL]) {
      merged.set(tool.name, tool);
    }
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
    merged.delete('agent_message');
    merged.delete('agent_check');
    merged.delete('agent_stop');
    merged.delete('agent_wake_parent');
    merged.delete('agent_room');
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
  return [...merged.values()].map((spec) => ({ ...spec, channel: channelFor(spec.name, spec.module) }));
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

const SEARCH_STOPWORDS = new Set(['para', 'con', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'que', 'por', 'como',
  'mas', 'quiero', 'necesito', 'hacer', 'este', 'esta', 'esto', 'ese', 'esa', 'sus', 'mis', 'sobre', 'desde', 'hasta',
  'entre', 'cuando', 'donde', 'todo', 'todos', 'toda', 'todas', 'muy', 'sin', 'hay', 'puedes', 'favor', 'usuario',
  'requiere', 'aprobacion', 'solo', 'lectura', 'efecto', 'the', 'and', 'for', 'with']);

function rankTools(specs, args) {
  const modules = Array.isArray(args.modules) ? args.modules.map(String) : [];
  const query = normal(args.query);
  const words = query.split(/[^a-z0-9_]+/).filter((word) => word.length > 2 && !SEARCH_STOPWORDS.has(word));
  const catalog = require('../shared/agent-modules.json').modules;
  const hints = (module) => normal([module, catalog[module]?.label, ...(catalog[module]?.aliases || [])].join(' '));
  const score = (spec) => {
    if (modules.includes(spec.module)) return 100;
    if (words.includes(normal(spec.name))) return 50;
    const name = normal(spec.name);
    const hint = hints(spec.module);
    const description = normal(`${spec.label || ''} ${spec.description || ''}`);
    return words.reduce((total, word) => total
      + (name.includes(word) ? 3 : 0) + (hint.includes(word) ? 2 : 0) + (description.includes(word) ? 1 : 0), 0);
  };
  const scored = specs.map((spec) => [spec, score(spec)]).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const floor = scored.length ? Math.ceil(scored[0][1] / 2) : 0;
  return scored.filter(([, value]) => value >= floor).slice(0, MAX_LOADED_TOOLS).map(([spec]) => spec);
}

async function loadTools(args, sessionId, context) {
  const conv = await conversation(sessionId);
  const enabled = new Set((await conv.agent(context)).tools.map((tool) => tool.name));
  const allows = await profileToolFilter(await requireSession(sessionId));
  const specs = [...shared.toolSpecs.values()].filter((spec) => (spec.kind !== 'meta'
    || ['task_schedule', 'agent_delegate', 'agent_message', 'agent_check', 'agent_stop', 'agent_room', 'wait_event'].includes(spec.name))
    && (!allows || allows(spec.name)));
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
  const found = rankTools(specs, args);
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

function contextWindowFor(session) {
  const model = shared.state && shared.state.models
    && shared.state.models.getModel(session && session.provider, session && session.model);
  if (model && Number(model.contextWindow) > 0) return Number(model.contextWindow);
  const record = shared.providers.get(session && session.provider);
  const window = Number(record && record.info && record.info.capabilities && record.info.capabilities.context_window);
  return window > 0 ? window : DEFAULT_CONTEXT_WINDOW;
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
      ...(spec.gated ? { executionMode: 'sequential' } : {}),
      execute: (args, api, context) => executeTool(spec, args, api, context),
    });
  });
  shared.state.registry.install(pi.defineExtension({
    name: 'antares.agent',
    tools: registrations,
    hooks: [
      pi.hook(pi.ToolTask, { beforeTool }),
      pi.hook(pi.CompactionTask, { beforeCompact: (c, r, context) => compaction.beforeCompact(c, r, context) }),
      pi.hook(pi.GenerationTask, {
        beforeRequest: async ({ messages }, api, context) => {
          resolvePortableProfile(shared.state.portableProfiles, api.conversationId);
          if (await toolBudget(api, context) >= MAX_TOOL_STEPS) await pauseForBudget(api, context);
          const budget = await profileBudget(await sessionProfile(
            (await sessions())[await sessionForConversation(api.conversationId, api, context)]));
          if (budget && budget.exhausted) await pauseForBudget(api, context, 'token_budget');
          await noteTurnStart(api, messages || []);
          const compacted = await compactRequest(messages, api, context);
          const warned = budgetWarning(compacted || messages, shared.rounds.get(api.conversationId) || 0);
          const next = warned || compacted || messages;
          return leadingSystem(next) || (compacted || warned ? { messages: next } : undefined);
        },
        afterTools: (_output, _task, api, context) => countRound(api, context),
        onYield: (answer, api) => planCheck(answer, api),
        afterResponse: async (message, api, context) => {
          try {
            const sessionId = await sessionForConversation(api.conversationId, api, context);
            await recordProfileUsage((await sessions())[sessionId], message.usage);
            if (message.stopReason !== 'toolUse') {
              try { require('./agent-browser').release(sessionId); } catch { }
            }
            if (message.stopReason === 'aborted') return;
            if (message.errorMessage) message.errorMessage = sanitizeProviderError(message.errorMessage);
            await commitSessions((sessions) => {
              if (sessions[sessionId]) sessions[sessionId].last_error = message.errorMessage ? message.errorMessage.slice(0, 300) : null;
              if (sessions[sessionId] && !message.errorMessage && message.stopReason === 'stop'
                && (shared.rounds.get(api.conversationId) || 0) < MAX_TOOL_STEPS) delete sessions[sessionId].continuation;
            });
          } finally {
            if (message.stopReason !== 'toolUse') requiredSkills.delete(api.conversationId);
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

function budgetWarning(messages, rounds) {
  const last = messages[messages.length - 1];
  if (rounds < BUDGET_WARNING_STEPS || rounds >= MAX_TOOL_STEPS || !last || last.role !== 'toolResult') return undefined;
  const notice = `Aviso de Antares: llevas ${rounds} de ${MAX_TOOL_STEPS} pasos de herramienta en este turno. `
    + 'Actualiza task_plan con lo verificado y prioriza lo pendiente; al llegar al límite el turno se pausa y el usuario '
    + 'puede Reanudar. No te detengas solo por este aviso.';
  const content = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content || '') }];
  return [...messages.slice(0, -1), { ...last, content: [...content, { type: 'text', text: notice }] }];
}

async function countRound(api, context) {
  if (await toolBudget(api, context, true) >= MAX_TOOL_STEPS) await pauseForBudget(api, context);
}

async function toolBudget(api, context, completed = false) {
  const { harness, BudgetDoc } = shared.state;
  const { rounds, submission_id } = await harness.commit(async (tx) => {
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
    return { rounds: budget.rounds, submission_id: typeof run === 'number' ? run : null };
  }, context);
  shared.rounds.set(api.conversationId, rounds);
  shared.turnRuns.set(api.conversationId, submission_id);
  return rounds;
}

async function pauseForBudget(api, context, reason = 'tool_budget') {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const remaining = turnState(api.conversationId).remaining || [];
  await commitSessions((map) => {
    if (map[sessionId]) map[sessionId].continuation = {
      reason, ...(reason === 'tool_budget' ? { rounds: MAX_TOOL_STEPS } : {}), pending_steps: remaining, created_at: Date.now(),
    };
  });
  const conv = await conversation(sessionId);
  const stopped = shared.state.harness.abortTask(api.taskId, ctx()).then(async () => {
    await conv.waitForIdle(ctx());
    return conv.submit({ type: 'write', requestId: `budget:${api.taskId}`, entry: {
      kind: shared.NOTICE_KIND, data: { text: (reason === 'token_budget'
        ? 'El agente agotó su presupuesto diario de tokens. Conservé un punto de continuación; '
          + 'podrás reanudar mañana o al ampliar su presupuesto.'
        : 'Este turno alcanzó su límite de pasos. Conservé un punto de continuación. Usa Reanudar para seguir.')
        + (remaining.length ? '\nPendiente: ' + remaining.join('; ') : '') },
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
    turn = { calls: new Map(), failures: new Map(), remaining: null, checked: false };
    shared.turns.set(conversationId, turn);
  }
  return turn;
}

const TURN_SUMMARY_CHARS = 300;

function boundedSummary(value) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  return collapsed.length > TURN_SUMMARY_CHARS ? `${collapsed.slice(0, TURN_SUMMARY_CHARS)}...` : collapsed;
}

function messageText(content, excludeContext = false) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part && part.type === 'text'
      && (!excludeContext || !String(part.text || '').startsWith(shared.CONTEXT_MARKER))).map((part) => part.text).join(' ');
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
      input_summary: boundedSummary(messageText(lastUserContent(messages), true)),
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

function callSignature(name, args) {
  return `${name}:${stableJson(args || {})}`;
}

function errorSignature(message) {
  return String(message || '').toLowerCase()
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/(["'`«“])[^"'`»”]*["'`»”]/g, '<valor>')
    .replace(/(?:[a-z]:)?[\\/][^\s,;)]+/g, '<ruta>')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\d+(?:[.,]\d+)?/g, '<n>')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
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
  const skillId = requiredSkills.get(api.conversationId);
  if (skillId && !(call.name === 'skills_read' && (call.arguments || {}).skill_id === skillId)) {
    return { block: `Antes de cualquier otra herramienta carga la skill elegida por el usuario con skills_read y skill_id "${skillId}".` };
  }
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const session = await requireSession(sessionId);
  // El hijo solo conserva los controles de su propio ciclo de vida: avisar al
  // padre y participar en salas no son lecturas del backend ni amplían acceso.
  const childControl = !!session.delegation && CHILD_CONTROL_TOOLS.has(call.name);
  if (!childControl && !await toolEnabled(sessionId, call.name, context)) {
    return { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
  }
  const calls = turnState(api.conversationId).calls;
  const signature = callSignature(call.name, call.arguments);
  let repeated = calls.get(signature);
  if (!repeated) {
    repeated = { count: 0, outcome: undefined, exempt: false };
    calls.set(signature, repeated);
  }
  if (repeated.uncertain) {
    return { block: `El resultado anterior de ${call.name} quedó incierto y la acción podría haberse aplicado. `
      + 'No la repitas: comprueba el estado con una herramienta de lectura o informa al usuario de qué necesitas para verificarlo.' };
  }
  const failing = turnState(api.conversationId).failures.get(call.name);
  if ((repeated.recoveries || 0) >= MAX_RECOVERABLE_FAILURES || (failing?.recoveries || 0) >= MAX_RECOVERABLE_FAILURES) {
    return { block: `Las últimas ${MAX_RECOVERABLE_FAILURES} recuperaciones de ${call.name} no resolvieron el fallo. No la repitas: `
      + 'diagnostica la causa con otra herramienta, cambia de enfoque o informa al usuario de qué te bloquea.' };
  }
  if (repeated.count >= MAX_REPEATS && !repeated.exempt) {
    const detail = spec.name === 'web_click' ? 'sin cambiar de página'
      : !spec.gated || spec.name === 'desktop_observe' ? 'con el mismo resultado o error' : 'con los mismos argumentos';
    return { block: `Ya llamaste a ${call.name} ${MAX_REPEATS} veces en este turno ${detail}. No la repitas: `
      + 'cambia de enfoque o informa al usuario de qué te bloquea, qué comprobaste y qué necesitas.' };
  }
  if (failing && failing.count >= MAX_REPEATS) {
    return { block: `Las últimas ${MAX_REPEATS} llamadas a ${call.name} fallaron por la misma causa aunque cambiaste los argumentos `
      + `(«${failing.message}»). No la repitas: diagnostica la causa con otra herramienta, cambia de enfoque `
      + 'o informa al usuario de qué te bloquea, qué comprobaste y qué necesitas.' };
  }
  if (session.delegation && !childControl && (spec.kind !== 'backend' || spec.replay_safe !== true)) {
    return { block: 'El agente delegado solo puede usar lecturas idempotentes autorizadas' };
  }
  const retryDelay = Math.max(repeated.retryAt || 0, failing?.retryAt || 0) - Date.now();
  if (retryDelay > 0) {
    await waitResource(context, Math.min(retryDelay, MAX_RETRY_AFTER_MS));
    if (!childControl && !await toolEnabled(sessionId, call.name, context)) {
      return { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
    }
  }
  const mode = session.permission_mode || 'auto';
  const rules = { ...shared.globalRules, ...(session.approval_rules || {}) };
  const channel = spec.channel || channelFor(call.name, spec.module);
  const rule = rules[channel];
  const web = call.name.startsWith('web_');
  const reading = spec.name === 'task_schedule' && (call.arguments || {}).action === 'list';
  if (reading || (!spec.gated && !(web && (mode === 'ask' || rule !== undefined)))) return undefined;
  if (rule === 'deny') {
    return { block: `El usuario bloqueó el canal «${channelLabel(channel)}» en esta conversación. `
      + 'No repitas esta acción: pide permiso, cambia la regla en Permisos o propone otra vía.' };
  }
  const unattendedApps = await unattendedAllowlist(api, context, mode, spec);
  if (unattendedApps && DESKTOP_ACTION_TOOLS.has(call.name)) {
    return { block: 'En un encargo programado las acciones desktop_* no se aprueban porque no identifican la aplicación. '
      + 'Usa cua_launch_app y las herramientas cua_* sobre una app de la lista blanca del encargo.' };
  }
  if (unattendedApps && UNATTENDED_ACTION_TOOLS.has(call.name)) {
    const turn = turnState(api.conversationId);
    turn.uiActions = (turn.uiActions || 0) + 1;
    if (turn.uiActions > MAX_UNATTENDED_ACTIONS) {
      return { block: `Alcanzaste el techo de ${MAX_UNATTENDED_ACTIONS} acciones sobre apps de este encargo programado. `
        + 'Detente e informa de lo hecho y de lo que quedó pendiente.' };
    }
  }

  const callId = dispatchCallId(call.id, api.taskId);
  let approval;
  try {
    const approvedContext = spec.kind === 'native'
      ? await nativeTools().nativeToolContext(spec.name, sessionId, call.arguments || {}) : undefined;
    ({ approval } = await bridge('agent_internal_approval_ensure', {
      session_id: sessionId,
      call_id: callId,
      method: call.name,
      params: call.arguments || {},
      channel,
      ...(approvedContext ? { context: approvedContext } : {}),
      ...(unattendedApps ? { unattended_apps: unattendedApps } : {}),
    }));
    const command = (call.arguments || {}).command;
    const fullShell = SHELL_TOOLS.has(call.name) && !unattendedApps
      && typeof command === 'string' && !DESTRUCTIVE_COMMAND.test(command);
    const autoSource = rule === 'allow' && !NEVER_AUTO_APPROVE.has(call.name) ? 'rule'
      : mode === 'full' && (!NEVER_AUTO_APPROVE.has(call.name) || fullShell) && rule !== 'ask' ? 'full'
        : rule !== 'ask' && webAlwaysAllowed(call.name, approvedContext) ? 'web' : null;
    if (autoSource && approval.status === 'pending') {
      ({ approval } = await bridge('agent_internal_approval_decide', {
        approval_id: approval.id, approve: true, source: autoSource,
      }));
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

async function unattendedAllowlist(api, context, mode, spec) {
  if (mode === 'ask' || !spec.gated) return null;
  const submissionId = shared.turnRuns.get(api.conversationId);
  if (!submissionId) return null;
  return shared.unattendedApps.get(submissionId) || null;
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
  const session = await requireSession(sessionId);
  const childControl = !!session.delegation && CHILD_CONTROL_TOOLS.has(spec.name);
  if (!childControl && !await toolEnabled(sessionId, spec.name, context)) {
    const text = `Herramienta deshabilitada en esta conversación: ${spec.name}`;
    noteToolResult(api, spec.name, text, true);
    return { content: [{ type: 'text', text }], isError: true };
  }
  const uiAction = UI_ACTION_TOOLS.has(spec.name);
  if (uiAction) require('./agent-overlay').showOverlay(sessionId, turnState(api.conversationId).uiRect);
  let text;
  let added;
  try {
    ({ text, added } = await dispatchTool(spec, args, sessionId, api, context));
  } catch (err) {
    noteToolResult(api, spec.name, `error: ${(err && err.message) || err}`, true);
    throw err;
  } finally {
    if (uiAction) require('./agent-overlay').hideOverlay(sessionId);
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { }
  const rect = parsed && (Array.isArray(parsed.window_rect) ? parsed.window_rect
    : (parsed.window && Array.isArray(parsed.window.rect) ? parsed.window.rect : null));
  if (rect) turnState(api.conversationId).uiRect = rect;
  const isError = !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
  if (spec.name === 'skills_read' && !isError && requiredSkills.get(api.conversationId) === (args || {}).skill_id) {
    requiredSkills.delete(api.conversationId);
  }
  if (spec.name === 'task_plan' && !isError && parsed && Array.isArray(parsed.remaining)) {
    turnState(api.conversationId).remaining = parsed.remaining.map(String);
  }
  const image = isError || !await acceptsImages(api, context) ? null : await resultImage(parsed);
  const calls = turnState(api.conversationId).calls;
  const signature = callSignature(spec.name, args);
  let repeated = calls.get(signature);
  if (!repeated) {
    repeated = { count: 0, outcome: undefined, exempt: false };
    calls.set(signature, repeated);
  }
  let outcome = stableJson(parsed ?? text);
  const capture = parsed && (parsed.image || (parsed.observation && parsed.observation.image));
  if (capture && typeof capture.path === 'string') {
    const fingerprint = image ? crypto.createHash('sha256').update(image.data).digest('hex') : 'captura';
    outcome = outcome.replaceAll(JSON.stringify(capture.path), JSON.stringify(fingerprint));
  }
  const trackOutcome = !spec.gated || spec.name === 'desktop_observe' || spec.name === 'web_click';
  const progress = spec.name === 'web_click'
    ? stableJson({ url: parsed && parsed.page && parsed.page.url ? String(parsed.page.url) : '' })
    : outcome;
  const hash = crypto.createHash('sha256').update(progress).digest('hex');
  repeated.uncertain = !!(parsed && parsed.uncertain === true && (spec.gated || spec.replay_safe !== true));
  const exempt = !!(!spec.gated && spec.replay_safe === true && isError && parsed && typeof parsed === 'object'
    && (parsed.retryable === true || parsed.recoverable === true) && parsed.uncertain !== true);
  if (exempt) {
    repeated.exempt = true;
    repeated.count = 0;
    repeated.recoveries = (repeated.recoveries || 0) + 1;
    repeated.retryAt = Date.now() + (Number.isFinite(parsed.retry_after_ms)
      ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, parsed.retry_after_ms)) : 0);
  } else if (trackOutcome && repeated.outcome !== undefined && repeated.outcome !== hash) {
    repeated.count = 1;
    repeated.exempt = false;
  } else {
    repeated.count = (repeated.count || 0) + 1;
    repeated.exempt = false;
  }
  if (trackOutcome) repeated.outcome = hash;
  if (!isError) {
    repeated.recoveries = 0;
    repeated.retryAt = 0;
  }
  const failures = turnState(api.conversationId).failures;
  if (!isError) {
    failures.delete(spec.name);
  } else {
    const message = String(typeof parsed.error === 'string' ? parsed.error : (parsed.error && parsed.error.message) || parsed.message || text);
    const key = errorSignature(message);
    const previous = failures.get(spec.name);
    const sameCause = previous && previous.key === key;
    failures.set(spec.name, { key, message: message.replace(/\s+/g, ' ').slice(0, 160),
      count: exempt ? 0 : sameCause ? previous.count + 1 : 1,
      recoveries: (sameCause ? previous.recoveries || 0 : 0) + (exempt ? 1 : 0),
      retryAt: exempt ? repeated.retryAt : 0 });
  }
  noteToolResult(api, spec.name, text, isError);
  const hooks = require('./agent-hooks');
  const hookProfile = resolvePortableProfile(shared.state.portableProfiles, api.conversationId);
  const pre = hooks.contextFor(hookProfile, 'preToolUse', spec.name);
  const post = hooks.contextFor(hookProfile, 'postToolUse', spec.name);
  if (pre) hooks.record(session, 'preToolUse', spec.name);
  if (post) hooks.record(session, 'postToolUse', spec.name);
  return { content: [
    ...(pre ? [{ type: 'text', text: pre }] : []),
    { type: 'text', text },
    ...(image ? [image] : []),
    ...(post ? [{ type: 'text', text: post }] : []),
  ], isError, ...(added && added.length ? { control: { addTools: added } } : {}) };
}

async function dispatchTool(spec, args, sessionId, api, context) {
  const portableProfile = resolvePortableProfile(shared.state.portableProfiles, api.conversationId);
  if (spec.kind === 'meta') {
    if (spec.name === 'agent_delegate') {
      const profile = await resolveProfile(args?.agent);
      if (!profile) throw validation('No se encontró un agente único; usa su identificador');
      return { text: JSON.stringify(await require('./agent-tasks').delegate(profile, args, sessionId, api, context)) };
    }
    if (spec.name === 'agent_check') {
      return { text: JSON.stringify(await require('./agent-tasks').checkDelegations(args || {}, sessionId)) };
    }
    if (spec.name === 'agent_message') {
      return { text: JSON.stringify(await require('./agent-tasks').sendMessage(args || {}, sessionId, api)) };
    }
    if (spec.name === 'agent_stop') {
      return { text: JSON.stringify(await require('./agent-tasks').stopDelegation(args || {}, sessionId)) };
    }
    if (spec.name === 'agent_wake_parent') {
      return { text: JSON.stringify(await require('./agent-tasks').wakeParent(args || {}, sessionId)) };
    }
    if (spec.name === 'agent_room') {
      return { text: JSON.stringify(await require('./agent-rooms').act(args || {}, sessionId)) };
    }
    if (spec.name === 'task_schedule') {
      if (spec.gated && (args || {}).action !== 'list') {
        return { text: await dispatchMeta(spec, args, sessionId, api, context) };
      }
      return { text: JSON.stringify(await require('./agent-tasks').schedule(args || {}, sessionId, api)) };
    }
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
    channel: spec.channel || channelFor(spec.name, spec.module),
    ...(spec.kind === 'native' ? { context: await nativeTools().nativeToolContext(spec.name, sessionId, args || {}) } : {}),
  };
  if (spec.name === 'skills_list' || spec.name === 'skills_read') {
    request.context = { profile_id: (await requireSession(sessionId)).profile?.id || null };
    if (portableProfile) {
      request.context.profile_skills = [...portableProfile.skills.values()].map(({ content, ...skill }) => ({
        ...skill,
        ...(skill.id === args?.skill_id && (!args.file_path || args.file_path === 'SKILL.md') ? { content } : {}),
      }));
    }
  }
  if (spec.kind === 'subagent') {
    const profile = await resolveProfile(args && args.agent);
    if (!profile) return { text: JSON.stringify({ error: 'No se encontró un agente único con esa referencia; usa el identificador de un bot disponible' }) };
    const conv = await conversation(sessionId);
    const enabled = (await conv.agent(context)).tools.map((tool) => tool.name);
    const session = await requireSession(sessionId);
    const allows = profileFilter(profile);
    const budget = await profileBudget(profile);
    if (budget && budget.exhausted) {
      return { text: JSON.stringify({ error: 'Este agente agotó su presupuesto diario de tokens; amplíalo o continúa mañana' }) };
    }
    request.context = {
      subagent: {
        id: profile.id,
        name: profile.name,
        role: profile.role || 'explorer',
        instructions: profile.instructions,
        tools: allows ? enabled.filter(allows) : null,
        memory_scope: profile.memory_scope || 'shared-read',
        remaining_tokens: budget ? budget.limit - budget.used : null,
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
    return { text };
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

async function dispatchMeta(spec, args, sessionId, api, context, options = {}) {
  const callId = options.callId || dispatchCallId(api.callId, api.taskId);
  const approvalId = options.approvalId || shared.approvalsByCall.get(callKey(sessionId, callId));
  const request = {
    session_id: sessionId,
    call_id: callId,
    name: spec.name,
    params: args || {},
    approval_id: approvalId,
    meta: true,
    gated: true,
    channel: spec.channel || channelFor(spec.name, spec.module),
  };
  const first = await bridge('agent_internal_dispatch', request);
  if (first.execute !== 'meta') {
    let result = first.result;
    if (result === null || result === undefined) {
      result = await pollDispatch(sessionId, callId, context);
    }
    return String(result);
  }
  let text;
  try {
    text = JSON.stringify(await require('./agent-tasks').schedule(args || {}, sessionId, api));
  } catch (err) {
    text = JSON.stringify({ error: String((err && err.message) || err).slice(0, 500) });
  }
  const finished = await bridge('agent_internal_dispatch_finish', {
    session_id: sessionId,
    call_id: callId,
    op_id: first.dispatch.op_id,
    result: text,
  });
  return String(finished.result);
}

async function dispatchNative(spec, request, context) {
  let first = await bridge('agent_internal_dispatch', { ...request, native: true, gated: !!spec.gated });
  while (first.busy) {
    await waitResource(context);
    if (!await toolEnabled(request.session_id, spec.name, context)) {
      return JSON.stringify({ error: `Herramienta deshabilitada en esta conversación: ${spec.name}` });
    }
    request.context = await nativeTools().nativeToolContext(spec.name, request.session_id, request.params);
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
    text = JSON.stringify({
      error: String((err && err.message) || err).slice(0, 500),
      ...(err?.code ? { code: String(err.code) } : {}),
      ...(err?.retryable === true ? { retryable: true } : {}),
      ...(err?.recoverable === true ? { recoverable: true } : {}),
      ...(Number.isFinite(err?.retryAfterMs) ? { retry_after_ms: Math.max(0, Math.round(err.retryAfterMs)) } : {}),
      ...(uncertain ? { interrupted: true, uncertain: true } : {}),
    });
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
      channel: approval.channel || spec.channel || channelFor(spec.name, spec.module),
    };
    if (spec.kind === 'native') {
      request.context = await nativeTools().nativeToolContext(spec.name, request.session_id, request.params);
      return dispatchNative(spec, request, context);
    }
    if (spec.kind === 'meta' && spec.name === 'task_schedule' && spec.gated) {
      const taskId = dispatchTaskId(approval.call_id) || approval.call_id;
      return dispatchMeta(spec, approval.params || {}, approval.session_id,
        { callId: providerCallId(approval.call_id), taskId }, context,
        { callId: approval.call_id, approvalId: approval.id });
    }
    return dispatchAndWait(request, context);
  } catch (err) {
    return JSON.stringify({ error: String((err && err.message) || err).slice(0, 500) });
  }
}

async function sessionProfile(session) {
  const id = session && session.profile && !session.profile.portable ? session.profile.id : null;
  return id ? (await profiles())[id] || null : null;
}

function profileDenied(profile) {
  const denied = new Set((profile && profile.tools_deny) || []);
  if (profile && profile.memory_scope === 'none') for (const name of MEMORY_TOOLS) denied.add(name);
  return denied;
}

function profileFilter(profile) {
  const denied = profileDenied(profile);
  if (!profile || (!Array.isArray(profile.tools) && !denied.size)) return null;
  const allowed = Array.isArray(profile.tools) ? new Set(profile.tools) : null;
  return (name) => (!allowed || allowed.has(name)) && !denied.has(name);
}

async function profileToolFilter(session) {
  return profileFilter(await sessionProfile(session));
}

function localDay(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function profileBudget(profile) {
  const limit = Number(profile && profile.daily_tokens) || 0;
  if (!limit) return null;
  const doc = await shared.state.harness.snapshot(shared.state.ProfilesDoc, ctx());
  const entry = doc && doc.usage && doc.usage[profile.id];
  const day = localDay();
  const delegated = await bridge('agent_internal_profile_usage', { profile_id: profile.id, day });
  const used = (entry && entry.day === day ? Number(entry.tokens) || 0 : 0) + (Number(delegated.tokens) || 0);
  return { limit, used, exhausted: used >= limit };
}

async function recordProfileUsage(session, usage) {
  const id = session && session.profile && !session.profile.portable ? session.profile.id : null;
  const tokens = (Number(usage && usage.input) || 0) + (Number(usage && usage.output) || 0);
  if (!id || !tokens) return;
  const day = localDay();
  await shared.state.harness.commit(async (tx) => {
    const doc = await tx.doc(shared.state.ProfilesDoc);
    if (!doc.profiles[id]) return;
    doc.usage ||= {};
    const entry = doc.usage[id];
    doc.usage[id] = { day, tokens: (entry && entry.day === day ? Number(entry.tokens) || 0 : 0) + tokens };
  }, ctx());
}

function profileInitialTools(profile, specs) {
  const available = new Set(specs.map((spec) => spec.name));
  const allows = profileFilter(profile);
  const base = profile && Array.isArray(profile.tools)
    ? profile.tools.filter((name) => available.has(name)) : defaultToolNames(specs);
  return allows ? (base || [...available]).filter(allows) : base;
}

async function toolEnabled(sessionId, name, context) {
  const allows = await profileToolFilter((await sessions())[sessionId]);
  if (allows && !allows(name)) return false;
  const conv = await conversation(sessionId);
  return (await conv.agent(context)).tools.some((tool) => tool.name === name);
}

function waitResource(context, delayMs = 400) {
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
    }, delayMs);
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

function requireSkill(conversationId, skillId) {
  if (skillId) requiredSkills.set(conversationId, skillId);
  else requiredSkills.delete(conversationId);
}

module.exports = {
  allToolSpecs,
  defaultToolNames,
  moduleToolNames,
  rankTools,
  localDay,
  profileBudget,
  profileFilter,
  profileInitialTools,
  profileToolFilter,
  sessionProfile,
  TOOLS_LOAD,
  supportsVision,
  modelDefinition,
  catalogFor,
  leadingSystem,
  budgetWarning,
  callKey,
  providerInfo,
  thinkingLevelFor,
  reasoningLevels,
  supportsReasoning,
  REASONING_EFFORTS,
  ensureProvider,
  cappedOpenAIApi,
  refreshTools,
  notifyDecision,
  dispatchApproved,
  sanitizeProviderError,
  contextWindowFor,
  requireSkill,
};
