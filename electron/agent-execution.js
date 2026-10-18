'use strict';

// Ejecución del runtime del agente: proveedores pi-ai (con auth/base URL que
// resuelve el vault de Python) y herramientas pi-durable con aprobaciones,
// dispatch reservado por (session_id, call_id) y sondeo de resultados hacia
// Python. El call_id del proveedor solo es único dentro de su conversación.

const {
  shared,
  bridge,
  aborted,
  conversation,
  sessionForConversation,
  commitSessions,
} = require('./agent-shared');

const MAX_TOOL_STEPS = 12;
const LIMIT_NOTE = 'Alcancé el límite de pasos de herramienta para este turno.';
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;

// ---------- proveedores (pi-ai) ----------

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
  if (existing && existing.modelIds.has(modelId)
    && existing.info.base_url === info.base_url) return;
  const record = existing || { info, modelIds: new Set(), secrets: new Set() };
  record.info = info;
  if (modelId) record.modelIds.add(modelId);
  shared.providers.set(providerId, record);
  shared.state.models.setProvider(await buildProvider(record));
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
    models: [...modelIds].map((id) => ({
      id,
      name: id,
      api,
      provider: providerId,
      baseUrl: info.base_url,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
    })),
    api: anthropic ? shared.deps.aiAnthropic.anthropicMessagesApi() : shared.deps.aiOpenai.openAICompletionsApi(),
  });
}

// ---------- herramientas (registry pi-durable) ----------

async function allToolSpecs() {
  const { tools } = await bridge('agent_internal_tools', {});
  const merged = new Map(tools.map((tool) => [tool.name, tool]));
  for (const tool of nativeTools().nativeToolSpecs()) {
    const current = merged.get(tool.name);
    merged.set(tool.name, { ...current, ...tool, ...(tool.inheritSchema && current ? { inputSchema: current.inputSchema } : {}) });
  }
  return [...merged.values()];
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

async function beforeTool(call, api, context) {
  const spec = shared.toolSpecs.get(call.name);
  const rounds = shared.rounds.get(api.conversationId) || 0;
  if (rounds >= MAX_TOOL_STEPS) return { block: LIMIT_NOTE };
  if (!spec) return { block: `Herramienta no disponible para el agente: ${call.name}` };
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, call.name, context)) return { block: `Herramienta deshabilitada en esta conversación: ${call.name}` };
  if (!spec.gated) return undefined;

  let approval;
  try {
    const approvedContext = spec.kind === 'native' ? await nativeTools().nativeToolContext(spec.name) : undefined;
    ({ approval } = await bridge('agent_internal_approval_ensure', {
      session_id: sessionId,
      call_id: call.id,
      method: call.name,
      params: call.arguments || {},
      ...(approvedContext ? { context: approvedContext } : {}),
    }));
  } catch (err) {
    return { block: String((err && err.message) || err) };
  }
  shared.approvalsByCall.set(callKey(sessionId, call.id), approval.id);
  shared.liveApprovals.add(approval.id);
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
    const timer = setTimeout(resolve, 1500); // re-sondeo: TTL y decisiones cruzadas
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

async function dispatchAndWait(request, context) {
  const first = await bridge('agent_internal_dispatch', request);
  let result = first.result;
  while (result === null || result === undefined) {
    result = await pollDispatch(request.session_id, request.call_id, context);
  }
  return String(result);
}

async function executeTool(spec, args, api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  if (!await toolEnabled(sessionId, spec.name, context)) {
    return { content: [{ type: 'text', text: `Herramienta deshabilitada en esta conversación: ${spec.name}` }], isError: true };
  }
  const callId = api.callId;
  const approvalId = spec.gated ? shared.approvalsByCall.get(callKey(sessionId, callId)) : undefined;
  const request = {
    session_id: sessionId,
    call_id: callId,
    name: spec.name,
    params: args || {},
    approval_id: approvalId,
    ...(spec.kind === 'native' ? { context: await nativeTools().nativeToolContext(spec.name) } : {}),
  };
  let text;
  if (spec.name === 'ask_user') shared.waitingInput.add(sessionId);
  try {
    text = spec.kind === 'native'
      ? await dispatchNative(spec, request, context)
      : await dispatchAndWait(request, context);
  } finally {
    if (spec.name === 'ask_user') shared.waitingInput.delete(sessionId);
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { }
  const isError = !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
  return { content: [{ type: 'text', text }], isError };
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

function pollDispatch(sessionId, callId, context) {
  const signal = context && context.abortSignal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    const timer = setTimeout(async () => {
      try {
        const next = await bridge('agent_internal_dispatch_result', { session_id: sessionId, call_id: callId });
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
  callKey,
  providerInfo,
  ensureProvider,
  refreshTools,
  notifyDecision,
  dispatchAndWait,
  dispatchApproved,
  sanitizeProviderError,
};
