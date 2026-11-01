'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, finish, stubModule } = require('./helpers/harness');

stubModule('electron/agent-cua.js', { TOOLS: new Map(), run: async () => ({}), approvalContext: () => ({}), close: () => {} });
stubModule('electron/agent-browser.js', { ...require('../electron/agent-browser') });
const runtime = require('../electron/agent-runtime');
const native = require('../electron/agent-native-tools');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(50);
  }
  return false;
}

async function waitIdle(sessionId, timeoutMs = 15000) {
  return waitFor(async () => !(await runtime.handlers.agent_turn_status({ session_id: sessionId })).running, timeoutMs);
}

function makeBridge() {
  const state = { approvals: new Map(), seq: 0, dispatches: [], dispatchLog: [], grants: [], attention: {} };
  const bridge = async (method, params) => {
    switch (method) {
      case 'agent_internal_activity': return { attention: state.attention };
      case 'agent_internal_profile_usage': return { tokens: 0 };
      case 'agent_internal_memory_context': return { context: '', items: [] };
      case 'agent_internal_artifacts':
        return { artifacts: [], questions: [], context: { files: [], accounts: [], workspace: null } };
      case 'agent_internal_workspace_set': return { workspace: params.path || null };
      case 'agent_internal_tools':
        return {
          tools: [
            { name: 'canvas_list', kind: 'backend', module: 'canvas', description: 'Lista documentos', gated: false,
              replay_safe: true, inputSchema: { type: 'object', properties: {} } },
            { name: 'db_clear', kind: 'backend', module: 'documents', description: 'Borra datos', gated: true,
              replay_safe: false, inputSchema: { type: 'object', properties: {} } },
          ],
        };
      case 'agent_internal_provider':
        return { provider: params.provider, style: 'openai_chat', base_url: 'http://x', api_key: 'k',
          auth_type: 'api_key', extra_headers: {}, default_model: 'faux-1' };
      case 'agent_internal_approval_ensure': {
        let found = [...state.approvals.values()].find((approval) => approval.call_id === params.call_id);
        if (!found) {
          found = {
            id: `ap-${++state.seq}`, session_id: params.session_id, call_id: params.call_id,
            method: params.method, params: params.params, status: 'pending', channel: params.channel || null,
            created_at: Date.now(), decided_at: null, source: null,
          };
          state.approvals.set(found.id, found);
        }
        return { approval: { ...found } };
      }
      case 'agent_internal_approval_status': {
        const approval = state.approvals.get(params.approval_id);
        return { approval: approval ? { ...approval } : null };
      }
      case 'agent_internal_approval_decide': {
        const approval = state.approvals.get(params.approval_id);
        if (!approval || approval.status !== 'pending') throw new Error('Aprobación inexistente o ya decidida');
        approval.status = params.approve ? 'approved' : 'denied';
        approval.source = params.source || 'manual';
        approval.decided_at = Date.now();
        return { approval: { ...approval } };
      }
      case 'agent_internal_approvals_pending':
        return { approvals: [...state.approvals.values()].filter((approval) =>
          approval.session_id === params.session_id && approval.status === 'pending') };
      case 'agent_internal_approvals_deny_session':
        return { denied: [] };
      case 'agent_internal_dispatch': {
        state.dispatchLog.push(params.call_id);
        const record = {
          session_id: params.session_id,
          call_id: params.call_id,
          method: params.name,
          channel: params.channel || null,
          approval_source: 'none',
          status: 'succeeded',
          result: JSON.stringify({ ok: true, tool: params.name }),
        };
        state.dispatches.push(record);
        return { result: record.result, dispatch: record };
      }
      case 'agent_internal_dispatch_result': {
        const record = state.dispatches.find((item) =>
          item.session_id === params.session_id && item.call_id === params.call_id);
        return { result: record ? record.result : null };
      }
      case 'agent_internal_dispatch_cancel': return { cancelled: false };
      case 'agent_internal_dispatch_finish': return { result: params.result };
      case 'agent_internal_effects': return { dispatches: [] };
      case 'agent_internal_effect_undo': return { undone: true };
      case 'agent_internal_grants_add': return { granted: [] };
      case 'agent_internal_grants_revoke': return { revoked: 0 };
      case 'agent_internal_grant_remove': return { removed: 0 };
      case 'agent_internal_mentions': return { modules: [], unknown: [], ambiguous: [] };
      default: throw new Error(`bridge desconocido: ${method}`);
    }
  };
  return { bridge, state };
}

async function openFaux(responses, bridge, draftsDir) {
  const { MemoryStorage } = await import('@earendil-works/pi-durable');
  const { fauxProvider } = await import('@earendil-works/pi-ai');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-script-integration-'));
  await runtime.open({ storage: new MemoryStorage(), bridge, skipImport: true, dir });
  runtime._internal.shared.nativeTools = {
    ...native,
    draftsDir: () => draftsDir || path.join(dir, 'drafts'),
    nativeToolContext: async () => ({}),
    runNativeTool: async () => ({ ok: true }),
  };
  const faux = fauxProvider();
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses(responses);
  return faux;
}

async function main() {
  const { fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('script_run', {
        script: `const read = await tools.call('canvas_list', {});
          let gated = '';
          try { await tools.call('db_clear', {}); } catch (error) { gated = String(error.message || error); }
          return { read, gated };`,
      })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Lectura terminada'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['canvas_list', 'script_run'] });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Lee el catálogo' });
    assert(await waitIdle(session.id), 'el turno con script_run termina');
    let result;
    assert(await waitFor(async () => {
      const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
      result = messages.find((message) => message.role === 'tool_result' && message.name === 'script_run');
      return !!result;
    }), 'script_run deja un resultado en la conversación');
    const payload = JSON.parse(result.content);
    assert(payload.result && payload.result.read && payload.result.read.ok === true,
      'la llamada interna atraviesa el mismo dispatch del agente');
    assert(/no permitida en script_run/.test(payload.result.gated),
      'una herramienta gated no entra al catálogo del script');
    assert(state.dispatchLog.filter((id) => id === 'script_run').length === 0,
      'script_run no se despacha al backend nativo');
    assert(state.dispatchLog.length === 1 && state.dispatches[0].method === 'canvas_list',
      'solo la lectura permitida llega al dispatch');
    await runtime.shutdown();
  }
  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('script_run', {
        script: `let denied = '';
          try { await tools.call('web_read', {}); } catch (error) { denied = String(error.message || error); }
          return { denied };`,
      })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Lectura bloqueada'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['web_read', 'script_run'] });
    await runtime.handlers.agent_session_rules_set({ id: session.id, rules: { desktop: 'deny' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Intenta leer con la regla deny' });
    assert(await waitIdle(session.id), 'el turno con una lectura denegada termina');
    let result;
    assert(await waitFor(async () => {
      const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
      result = messages.find((message) => message.role === 'tool_result' && message.name === 'script_run');
      return !!result;
    }), 'la lectura denegada devuelve un resultado de script_run');
    const payload = JSON.parse(result.content);
    assert(payload.result && /bloqueó/.test(payload.result.denied),
      'la regla deny del canal se aplica dentro del script');
    assert(state.dispatchLog.length === 0, 'una lectura denegada no llega al dispatch');
    await runtime.shutdown();
  }
  {
    const { bridge, state } = makeBridge();
    await openFaux([
      fauxAssistantMessage([fauxToolCall('script_run', {
        script: `return await tools.call('web_read', {});`,
      })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Lectura aprobada'),
    ], bridge);
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['web_read', 'script_run'] });
    await runtime.handlers.agent_session_rules_set({ id: session.id, rules: { desktop: 'ask' } });
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Lee la página actual' });
    assert(await waitFor(() => state.approvals.size === 1), 'la lectura web del script pide aprobación');
    assert(state.dispatchLog.length === 0, 'la lectura no se ejecuta antes de aprobar');
    const approval = [...state.approvals.values()][0];
    await runtime.handlers.agent_approve({ approval_id: approval.id });
    assert(await waitIdle(session.id), 'la lectura aprobada deja terminar el script');
    let result;
    assert(await waitFor(async () => {
      const { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
      result = messages.find((message) => message.role === 'tool_result' && message.name === 'script_run');
      return !!result;
    }), 'la lectura aprobada deja su resultado en la conversación');
    const payload = JSON.parse(result.content);
    assert(payload.result && payload.result.ok === true, 'la lectura aprobada devuelve el resultado al script');
    assert(state.dispatchLog.length === 1, 'la aprobación ejecuta la lectura una sola vez');
    await runtime.shutdown();
  }
  console.log('\n[PASS] script_run: aprobaciones y reglas compartidas.');
  finish();
}

main().catch(async (error) => {
  console.error(error);
  try { await runtime.shutdown(); } catch { }
  process.exit(1);
});
