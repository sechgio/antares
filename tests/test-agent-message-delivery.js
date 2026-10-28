'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const tasks = require('../electron/agent-tasks');
const { conversation } = require('../electron/agent-shared');
const projection = require('../electron/agent-projection');

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

async function main() {
  const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-message-delivery-'));
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
    if (lastUser(context).includes('FASE6: prepara el informe')) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return fauxAssistantMessage('Informe listo');
    }
    return fauxAssistantMessage('Mensaje recibido');
  };
  faux.setResponses(Array.from({ length: 20 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const apiFor = (taskId, callId) => ({ taskId, callId, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) });
  try {
    await tasks.stop();
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Revisor', instructions: 'FASE6: prepara el informe', tools: null,
    });
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegated = await tasks.delegate(profile, { agent: profile.id, task: 'FASE6: prepara el informe' },
      parent.id, apiFor('fase6-turno-1', 'call-1'), {});
    await tasks.start();
    await until(async () => (await messages(parent.id)).delegations?.[0]?.running === true);
    await assert.rejects(
      tasks.sendMessage({ session_id: delegated.session_id, message: 'FASE6: sin modo', delivery: 'now' }, parent.id, {}),
      /delivery debe ser steer o follow_up/,
      'un modo de entrega desconocido se rechaza',
    );
    const queued = await tasks.sendMessage({
      session_id: delegated.session_id, message: 'FASE6: añade el anexo al terminar', delivery: 'follow_up',
    }, parent.id, apiFor('fase6-mensaje-1', 'call-m1'));
    assert.equal(queued.sent, true);
    assert.equal(queued.delivery, 'follow_up', 'el resultado declara el modo aplicado');
    const steered = await tasks.sendMessage({
      session_id: delegated.session_id, message: 'FASE6: usa la plantilla vigente',
    }, parent.id, apiFor('fase6-mensaje-2', 'call-m2'));
    assert.equal(steered.delivery, 'steer', 'sin modo explícito se conserva el turno en curso');
    await until(async () => {
      const entries = JSON.stringify(await projection.allEntries(await conversation(delegated.session_id)));
      return entries.includes('FASE6: añade el anexo al terminar') && entries.includes('FASE6: usa la plantilla vigente');
    });

    console.log('[PASS] agent_message: delivery acepta steer y follow_up, rechaza un modo desconocido, declara el '
      + 'modo aplicado y el mensaje llega al encargo como contexto adicional.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
