'use strict';

// Ejecución del runtime del agente: proveedores pi-ai (con auth/base URL que
// resuelve el vault de Python) y herramientas pi-durable con aprobaciones,
// dispatch deduplicado por call_id y sondeo de resultados hacia Python.

const {
  shared,
  bridge,
  aborted,
  sessionForConversation,
} = require('./agent-shared');

const MAX_TOOL_STEPS = 12;
const LIMIT_NOTE = 'Alcancé el límite de pasos de herramienta para este turno.';
const INTERRUPTED_RESULT = shared.INTERRUPTED_RESULT;

// ---------- proveedores (pi-ai) ----------

async function providerInfo(provider) {
  return bridge('agent_internal_provider', { provider });
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
  const record = existing || { info, modelIds: new Set() };
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

async function refreshTools() {
  const { pi } = shared.deps;
  const { tools } = await bridge('agent_internal_tools', {});
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
      pi.hook(pi.GenerationTask, { afterTools: () => countRound() }),
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
  if (!spec.gated) return undefined;

  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const { approval } = await bridge('agent_internal_approval_ensure', {
    session_id: sessionId,
    call_id: call.id,
    method: call.name,
    params: call.arguments || {},
  });
  shared.approvalsByCall.set(call.id, approval.id);
  shared.liveApprovals.add(approval.id);
  try {
    let current = approval;
    while (current && current.status === 'pending') {
      await waitForDecision(current.id, context);
      if (context && context.abortSignal && context.abortSignal.aborted) throw aborted();
      const next = (await bridge('agent_internal_approval_status', { approval_id: current.id })).approval;
      current = next || { status: 'expired' };
    }
    if (current.status === 'approved') return undefined;
    if (current.status === 'denied') return { block: 'El usuario rechazó esta acción' };
    return { block: 'La aprobación expiró; vuelve a pedírselo al agente' };
  } finally {
    shared.liveApprovals.delete(approval.id);
  }
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
    result = await pollDispatch(request.call_id, context);
  }
  return String(result);
}

async function executeTool(spec, args, api, context) {
  const sessionId = await sessionForConversation(api.conversationId, api, context);
  const callId = api.callId;
  const approvalId = spec.gated ? shared.approvalsByCall.get(callId) : undefined;
  const text = await dispatchAndWait({
    session_id: sessionId,
    call_id: callId,
    name: spec.name,
    params: args || {},
    approval_id: approvalId,
  }, context);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* texto plano */ }
  const isError = !!(parsed && typeof parsed === 'object' && (parsed.error !== undefined || parsed.isError === true));
  return { content: [{ type: 'text', text }], isError };
}

function pollDispatch(callId, context) {
  const signal = context && context.abortSignal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    const timer = setTimeout(async () => {
      try {
        const next = await bridge('agent_internal_dispatch_result', { call_id: callId });
        resolve(next.result === undefined ? null : next.result);
      } catch (err) {
        resolve(INTERRUPTED_RESULT);
      }
    }, 400);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        bridge('agent_internal_dispatch_cancel', { call_id: callId }).catch(() => {});
        reject(aborted());
      }, { once: true });
    }
  });
}

module.exports = {
  providerInfo,
  ensureProvider,
  refreshTools,
  notifyDecision,
  dispatchAndWait,
};
