'use strict';

const {
  shared,
  bridge,
  aborted,
  conversation,
  profiles,
  sessionForConversation,
  commitSessions,
  dispatchCallId,
} = require('./agent-shared');

const MAX_TOOL_STEPS = 40;
const LIMIT_NOTE = 'Alcancé el límite de pasos de herramienta para este turno.';
// Repetir la misma llamada sin cambios no aporta información nueva: a partir
// de aquí se bloquea para que el agente cambie de vía o informe del bloqueo.
const MAX_REPEATS = 3;
const PLAN_CHECK_TEXT = 'Tu plan de este encargo aún tiene pasos sin verificar: {steps}. Antes de terminar, sigue con '
  + 'el siguiente y compruébalo; si no puedes completarlo, márcalo como failed en task_plan con la causa y di qué necesitas.';
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;
const SUBAGENT_TOOL = 'subagent_run';
const SUBAGENT_DESCRIPTION_MAX = 80;
const TOOLS_LOAD = 'tools_load';
// Núcleo que reciben las conversaciones nuevas: el resto del catálogo se carga
// con tools_load o al mencionar un módulo, para no superar el límite de
// herramientas por petición de los proveedores ni saturar modelos pequeños.
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
    && JSON.stringify(existing.info.capabilities || {}) === JSON.stringify(info.capabilities || {})) return;
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

function modelDefinition(info, id, api) {
  const capabilities = info.capabilities || {};
  const contextWindow = Number(capabilities.context_window) || DEFAULT_CONTEXT_WINDOW;
  let host = '';
  try { host = new URL(info.base_url).hostname; } catch { }
  const classic = info.custom && api === 'openai-completions' && !OPENAI_NATIVE_HOST.test(host);
  return {
    id,
    name: id,
    api,
    provider: info.provider,
    baseUrl: info.base_url,
    input: (typeof capabilities.vision === 'boolean' ? capabilities.vision : supportsVision(id)) ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 4)),
    reasoning: supportsReasoning(info.style, id),
    ...(classic ? { compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } } : {}),
  };
}

async function buildProvider(record) {
  const { createProvider } = await import('@earendil-works/pi-ai');
  const { info, modelIds } = record;
  const anthropic = info.style === 'anthropic_messages';
  const api = anthropic ? 'anthropic-messages' : 'openai-completions';
  const providerId = info.provider;
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
    models: [...modelIds].map((id) => modelDefinition(info, id, api)),
    api: anthropic ? shared.deps.aiAnthropic.anthropicMessagesApi() : shared.deps.aiOpenai.openAICompletionsApi(),
  });
}

async function allToolSpecs() {
  const { tools } = await bridge('agent_internal_tools', {});
  const merged = new Map(tools.map((tool) => [tool.name, tool]));
  for (const tool of nativeTools().nativeToolSpecs()) {
    const current = merged.get(tool.name);
    merged.set(tool.name, { ...current, ...tool, ...(tool.inheritSchema && current ? { inputSchema: current.inputSchema } : {}) });
  }
  const saved = Object.values(await profiles()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (saved.length > 0) {
    merged.set(SUBAGENT_TOOL, {
      name: SUBAGENT_TOOL,
      description: `Delega una tarea acotada en uno de los agentes guardados del usuario: solo lee datos y devuelve su resultado y sus pasos. Agentes disponibles: ${saved.map((profile) => `«${profile.name}» (${String(profile.description || 'agente personalizado').slice(0, SUBAGENT_DESCRIPTION_MAX)})`).join('; ')}.`,
      gated: false,
      kind: 'subagent',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Nombre exacto del agente guardado' },
          task: { type: 'string', description: 'Encargo concreto y autocontenido para el subagente' },
        },
        required: ['agent', 'task'],
      },
    });
  } else {
    merged.delete(SUBAGENT_TOOL);
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
  return [...merged.values()];
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
  const specs = [...shared.toolSpecs.values()].filter((spec) => spec.kind !== 'meta');
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
  return saved.find((profile) => profile.id === wanted)
    || saved.find((profile) => String(profile.name || '').trim().toLowerCase() === wanted.toLowerCase())
    || null;
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
      replay: 'unsafe',
      execute: (args, api, context) => executeTool(spec, args, api, context),
    });
  });
  shared.state.registry.install(pi.defineExtension({
    name: 'antares.agent',
    tools: registrations,
    hooks: [
      pi.hook(pi.ToolTask, { beforeTool }),
      pi.hook(pi.GenerationTask, {
        afterTools: (_output, _task, api) => countRound(api),
        onYield: (answer, api) => planCheck(answer, api),
        afterResponse: async (message, api, context) => {
          if (!message.errorMessage) return;
          message.errorMessage = sanitizeProviderError(message.errorMessage);
          const sessionId = await sessionForConversation(api.conversationId, api, context);
          await commitSessions((sessions) => {
            if (sessions[sessionId]) sessions[sessionId].last_error = message.errorMessage.slice(0, 300);
          });
        },
      }),
    ],
  }));
}

function countRound(api) {
  const n = (shared.rounds.get(api.conversationId) || 0) + 1;
  shared.rounds.set(api.conversationId, n);
}

function turnState(conversationId) {
  let turn = shared.turns.get(conversationId);
  if (!turn) {
    turn = { calls: new Map(), remaining: null, checked: false };
    shared.turns.set(conversationId, turn);
  }
  return turn;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Una respuesta final con pasos del plan de este turno sin verificar recibe una
// sola petición de seguir o de declarar el bloqueo; el aviso no se muestra en el chat.
function planCheck(answer, api) {
  const turn = shared.turns.get(api.conversationId);
  if (!turn || turn.checked || !turn.remaining || !turn.remaining.length) return undefined;
  if (answer.errorMessage || answer.stopReason === 'aborted' || answer.stopReason === 'error') return undefined;
  if ((shared.rounds.get(api.conversationId) || 0) >= MAX_TOOL_STEPS) return undefined;
  turn.checked = true;
  const steps = turn.remaining.map((title) => `«${title}»`).join(', ');
  return { continue: `${shared.CHECK_MARKER} ${PLAN_CHECK_TEXT.replace('{steps}', steps)}` };
}

async function beforeTool(call, api, context) {
  const spec = shared.toolSpecs.get(call.name);
  const rounds = shared.rounds.get(api.conversationId) || 0;
  if (rounds >= MAX_TOOL_STEPS) return { block: LIMIT_NOTE };
  if (!spec) return { block: `Herramienta no disponible para el agente: ${call.name}` };
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, call.name, context)) return { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
  const calls = turnState(api.conversationId).calls;
  const signature = `${call.name}:${stableJson(call.arguments || {})}`;
  const seen = (calls.get(signature) || 0) + 1;
  calls.set(signature, seen);
  if (seen > MAX_REPEATS) {
    return { block: `Ya llamaste a ${call.name} ${MAX_REPEATS} veces en este turno con los mismos argumentos. No lo repitas: `
      + 'cambia de enfoque o informa al usuario de qué te bloquea, qué comprobaste y qué necesitas.' };
  }
  if (!spec.gated) return undefined;

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
    const timer = setTimeout(resolve, 1500);
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      waiters.delete(done);
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

// El backend devuelve la salida en curso completa desde el principio (p. ej. la
// de shell_run); a pi-durable solo se le pasa lo nuevo para que la UI la vea crecer.
async function dispatchAndWait(request, context, api) {
  const first = await bridge('agent_internal_dispatch', request);
  let result = first.result;
  let shown = 0;
  const onOutput = (output) => {
    if (!api || output.length <= shown) return;
    api.output(output.slice(shown));
    shown = output.length;
  };
  while (result === null || result === undefined) {
    result = await pollDispatch(request.session_id, request.call_id, context, onOutput);
  }
  return String(result);
}

async function executeTool(spec, args, api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, spec.name, context)) {
    return { content: [{ type: 'text', text: `Herramienta deshabilitada en esta conversación: ${spec.name}` }], isError: true };
  }
  if (spec.kind === 'meta') {
    const { text, added } = await loadTools(args || {}, sessionId, context);
    return { content: [{ type: 'text', text }], isError: false, ...(added && added.length ? { control: { addTools: added } } : {}) };
  }
  const callId = dispatchCallId(api.callId, api.taskId);
  const approvalId = spec.gated ? shared.approvalsByCall.get(callKey(sessionId, callId)) : undefined;
  const request = {
    session_id: sessionId,
    call_id: callId,
    name: spec.name,
    params: args || {},
    approval_id: approvalId,
    ...(spec.kind === 'native' ? { context: await nativeTools().nativeToolContext(spec.name) } : {}),
  };
  if (spec.kind === 'subagent') {
    const profile = await resolveProfile(args && args.agent);
    if (!profile) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Ese agente guardado ya no existe; elige uno de los disponibles' }) }],
        isError: true,
      };
    }
    const conv = await conversation(sessionId);
    const enabled = (await conv.agent(context)).tools.map((tool) => tool.name);
    request.context = {
      subagent: {
        id: profile.id,
        name: profile.name,
        instructions: profile.instructions,
        tools: Array.isArray(profile.tools) ? profile.tools : null,
        enabled,
      },
    };
  }
  let text;
  if (spec.name === 'ask_user') shared.waitingInput.add(sessionId);
  try {
    text = spec.kind === 'native'
      ? await dispatchNative(spec, request, context)
      : await dispatchAndWait(request, context, api);
  } finally {
    if (spec.name === 'ask_user') shared.waitingInput.delete(sessionId);
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { }
  const isError = !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
  if (spec.name === 'task_plan' && !isError && parsed && Array.isArray(parsed.remaining)) {
    turnState(api.conversationId).remaining = parsed.remaining.map(String);
  }
  const image = isError || !await acceptsImages(api, context) ? null : await resultImage(parsed);
  return { content: [{ type: 'text', text }, ...(image ? [image] : [])], isError };
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
    while (result === null || result === undefined) {
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
    const timer = setTimeout(async () => {
      try {
        const next = await bridge('agent_internal_dispatch_result', { session_id: sessionId, call_id: callId });
        if (onOutput && typeof next.output === 'string') onOutput(next.output);
        resolve(next.result === undefined ? null : next.result);
      } catch (err) {
        resolve(INTERRUPTED_RESULT);
      }
    }, 400);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        bridge('agent_internal_dispatch_cancel', { session_id: sessionId, call_id: callId }).catch(() => {});
        reject(aborted());
      }, { once: true });
    }
  });
}

module.exports = {
  allToolSpecs,
  defaultToolNames,
  moduleToolNames,
  TOOLS_LOAD,
  supportsVision,
  modelDefinition,
  callKey,
  providerInfo,
  thinkingLevelFor,
  ensureProvider,
  refreshTools,
  notifyDecision,
  dispatchApproved,
  sanitizeProviderError,
};
