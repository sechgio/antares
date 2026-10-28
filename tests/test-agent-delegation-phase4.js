'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

function lastUser(context) {
  const users = (context.messages || []).filter((message) => message.role === 'user');
  return users.length ? (typeof users.at(-1).content === 'string' ? users.at(-1).content
    : (users.at(-1).content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')) : '';
}

function callCount(context, name) {
  return (context.messages || []).flatMap((message) => message.role === 'assistant'
    ? (message.content || []).filter((block) => block.type === 'toolCall' && block.name === name) : []).length;
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const tasks = require('../electron/agent-tasks');
  const { shared, conversation } = require('../electron/agent-shared');
  const projection = require('../electron/agent-projection');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-delegation-phase4-'));
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') return { result: JSON.stringify({ documents: ['Contrato'] }) };
    if (method === 'agent_internal_dispatch_result') return { result: JSON.stringify({ documents: ['Contrato'] }) };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    throw new Error(`Puente inesperado: ${method}`);
  };
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] });
  runtime._internal._providerOverrides.set('faux', faux.provider);
  const respond = async (context) => {
    const input = lastUser(context);
    if (input.includes('FASE4: revisa el contrato')) {
      return callCount(context, 'canvas_list') < 1
        ? fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' })
        : (await new Promise((resolve) => setTimeout(resolve, 1500)), fauxAssistantMessage('Contrato revisado'));
    }
    if (input.includes('FASE4: amplía la revisión')) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fauxAssistantMessage('Revisión ampliada');
    }
    return fauxAssistantMessage('Informe recibido');
  };
  faux.setResponses(Array.from({ length: 30 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const apiFor = (taskId, callId) => ({ taskId, callId, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) });
  try {
    await tasks.stop();
    const backoff = tasks._internal.deferredDelivery;
    assert.equal(backoff(undefined, 1, 1000).retry_at, 1000 + 60000, 'el primer reintento espera un minuto');
    assert.equal(backoff(undefined, 3, 1000).state, 'unreachable', 'al tercer fallo la entrega queda sin confirmar');
    assert.equal(backoff(undefined, 3, 1000).retry_at, 1000 + 240000, 'la espera se duplica en cada intento');
    assert.equal(backoff(undefined, 12, 1000).retry_at, 1000 + 600000, 'la espera tiene un tope de diez minutos');
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Trazador', instructions: 'FASE4: revisa el contrato', tools: null,
    });
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegated = await tasks.delegate(profile, { agent: profile.id, task: 'FASE4: revisa el contrato' },
      parent.id, apiFor('fase4-turno-1', 'call-1'), {});
    assert.equal(delegated.parent_request_id, 'fase4-turno-1');
    assert.equal(delegated.root_parent_request_id, 'fase4-turno-1');
    assert.equal(delegated.parent_tool_call_id, 'call-1');

    const pending = await tasks.checkDelegations({}, parent.id);
    assert.equal(pending.delegations.length, 1);
    assert.equal(pending.delegations[0].state, 'pendiente');
    assert.equal(pending.delegations[0].running, false);
    assert.equal(pending.delegations[0].parent_request_id, 'fase4-turno-1');
    assert.deepEqual((await messages(parent.id)).delegations.map((item) => item.session_id), [delegated.session_id],
      'la UI recibe el roster de delegaciones activas');

    await tasks.start();
    await until(async () => {
      const roster = (await messages(parent.id)).delegations || [];
      return roster[0]?.running === true && roster[0]?.last_tool?.name === 'canvas_list';
    });
    const live = (await messages(parent.id)).delegations[0];
    assert.equal(live.agent, 'Trazador');
    assert.equal(live.state, 'trabajando');
    assert.equal(typeof live.ms, 'number');
    assert.equal(live.last_tool.failed, false);

    await until(async () => (await tasks.checkDelegations({ session_id: delegated.session_id }, parent.id)).status === 'delivered');
    const finished = await tasks.checkDelegations({ session_id: delegated.session_id }, parent.id);
    assert.equal(finished.parent_request_id, 'fase4-turno-1');
    assert.equal(finished.root_parent_request_id, 'fase4-turno-1');
    assert.equal(finished.parent_tool_call_id, 'call-1');
    assert.equal(finished.running, false);
    assert.equal(finished.delivery.state, 'delivered', 'la entrega queda registrada como resuelta');
    assert.equal(finished.delivery.attempts, 0);
    assert.deepEqual((await messages(parent.id)).delegations, [], 'el roster se vacía al entregar el informe');

    const resumed = await tasks.delegate(profile, { agent: profile.id, task: 'FASE4: amplía la revisión', resume: delegated.session_id },
      parent.id, apiFor('fase4-turno-2', 'call-2'), {});
    assert.equal(resumed.parent_request_id, 'fase4-turno-2');
    assert.equal(resumed.root_parent_request_id, 'fase4-turno-1', 'la raíz del linaje se conserva al retomar');
    assert.equal(resumed.parent_tool_call_id, 'call-2');
    await until(async () => (await tasks.checkDelegations({ session_id: delegated.session_id }, parent.id)).status === 'delivered');

    await tasks.stop();
    const third = await tasks.delegate(profile, { agent: profile.id, task: 'FASE4: entrega con reintentos' },
      parent.id, apiFor('fase4-turno-3', 'call-3'), {});
    const thirdChild = (await runtime.handlers.agent_sessions_list()).sessions
      .find((session) => session.id === third.session_id);
    let deferred = null;
    for (const attempt of [1, 2, 3]) {
      await tasks._internal.deferDelegations(shared.state, [thirdChild], new Error('proveedor no disponible'));
      deferred = await tasks.checkDelegations({ session_id: third.session_id }, parent.id);
      assert.equal(deferred.delivery.attempts, attempt);
      assert.equal(deferred.delivery.state, attempt >= 3 ? 'unreachable' : 'deferred');
      const expected = 60000 * 2 ** (attempt - 1);
      assert.ok(Math.abs(deferred.delivery.retry_at - Date.now() - expected) < 5000,
        `el intento ${attempt} espera ${expected / 1000} s`);
    }
    assert.match(deferred.delivery.error, /proveedor no disponible/);
    const notices = (await projection.allEntries(await conversation(parent.id)))
      .filter((entry) => entry.kind === shared.NOTICE_KIND).map((entry) => String(entry.data?.text || ''));
    assert.ok(notices.some((text) => text.includes('3 intentos')),
      'el padre recibe un aviso cuando la entrega acumula tres fallos');

    console.log('[PASS] linaje, roster y entrega Fase 4a: claves request/tool call en el acuse y agent_check, raíz '
      + 'conservada al retomar, roster en vivo con estado, herramienta y duración, vaciado al entregar, y entrega '
      + 'tipada con espera creciente, tope y aviso al tercer fallo.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
