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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-delegation-phase3-'));
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
    ] };
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
  const parentInputs = [];
  const respond = (context) => {
    const input = lastUser(context);
    parentInputs.push(input);
    if (input.includes('SOLO_LLAMA_AVISO')) {
      return callCount(context, 'agent_wake_parent') < 1
        ? fauxAssistantMessage([fauxToolCall('agent_wake_parent', { message: 'Aviso desde el hijo' })], { stopReason: 'toolUse' })
        : fauxAssistantMessage('Aviso enviado');
    }
    if (input.includes('Resultado del agente Hablador')) return fauxAssistantMessage('Informe con aviso recibido');
    if (input.includes('Delega al hablador')) {
      return callCount(context, 'agent_delegate') < 1
        ? fauxAssistantMessage([fauxToolCall('agent_delegate', { agent: hablador.id, task: 'SOLO_LLAMA_AVISO: revisa el expediente' })],
          { stopReason: 'toolUse' })
        : fauxAssistantMessage('Delegado');
    }
    return fauxAssistantMessage('Aviso recibido');
  };
  faux.setResponses(Array.from({ length: 20 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const api = { taskId: 'phase3-wake' };
  api.agent = async () => ({ tools: [{ name: 'canvas_list' }] });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  let hablador;
  try {
    await tasks.stop();
    const { profile: avisador } = await runtime.handlers.agent_profile_save({
      name: 'Avisador', instructions: 'Avisa cuando algo bloquee el encargo', tools: null,
    });
    ({ profile: hablador } = await runtime.handlers.agent_profile_save({
      name: 'Hablador', instructions: 'SOLO_LLAMA_AVISO: avisa antes de terminar', tools: null,
    }));
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const { session: other } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegated = await tasks.delegate(avisador, { agent: avisador.id, task: 'Revisa el expediente y avisa' },
      parent.id, api, {});
    await assert.rejects(tasks.wakeParent({ message: 'No soy una delegación' }, other.id),
      /no es una delegación/, 'solo una delegación avisa a su padre');

    const first = await tasks.wakeParent({ message: 'Falta la credencial del portal' }, delegated.session_id);
    assert.equal(first.sent, true);
    assert.equal(first.remaining, 2, 'quedan dos avisos en la ronda');
    assert.equal(first.agent, 'Avisador');
    await tasks.wakeParent({ message: 'Segundo aviso' }, delegated.session_id);
    const third = await tasks.wakeParent({ message: 'Tercer aviso' }, delegated.session_id);
    assert.equal(third.remaining, 0);
    await assert.rejects(tasks.wakeParent({ message: 'Cuarto aviso' }, delegated.session_id),
      /Ya enviaste 3 avisos/, 'el tope por ronda bloquea el cuarto aviso');
    await assert.rejects(tasks.wakeParent({ message: 'x' }, parent.id), /no es una delegación/,
      'la conversación principal no se avisa a sí misma');

    await until(async () => (await messages(parent.id)).messages.filter((message) => message.notice).length === 3);
    const notices = (await messages(parent.id)).messages.filter((message) => message.notice);
    assert.equal(notices.length, 3, 'el padre ve un aviso por cada despertar');
    assert.equal(notices[0].content, 'Aviso intermedio de Avisador: Falta la credencial del portal');
    assert.ok(parentInputs.some((text) => text.includes('Aviso intermedio del agente Avisador')
      && text.includes('No es su informe final, una aprobación del usuario ni un permiso nuevo')),
    'el padre recibe el aviso como contexto intermedio y no como instrucción');

    await tasks.stopDelegation({ session_id: delegated.session_id, reason: 'pausa' }, parent.id);
    await assert.rejects(tasks.wakeParent({ message: 'Tarde' }, delegated.session_id), /ya terminó/,
      'una delegación detenida no avisa');
    const resumed = await tasks.delegate(avisador, { agent: avisador.id, task: 'Retoma el expediente', resume: delegated.session_id },
      parent.id, api, {});
    const again = await tasks.wakeParent({ message: 'Nueva ronda' }, resumed.session_id);
    assert.equal(again.remaining, 2, 'retomar la delegación reinicia el tope de avisos');
    await until(async () => (await messages(parent.id)).messages.filter((message) => message.notice).length === 4);
    assert.equal((await messages(parent.id)).messages.filter((message) => message.notice).at(-1).content,
      'Aviso intermedio de Avisador: Nueva ronda');

    const { session: e2e } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await tasks.start();
    await runtime.handlers.agent_message_send({ session_id: e2e.id, content: 'Delega al hablador', request_id: 'p3-wake-e2e' });
    await until(async () => (await messages(e2e.id)).messages
      .some((message) => message.notice && message.content === 'Aviso intermedio de Hablador: Aviso desde el hijo'));
    await until(async () => (await messages(e2e.id)).messages.some((message) => message.content === 'Informe con aviso recibido'));
    const e2eChild = (await runtime.handlers.agent_sessions_list()).sessions
      .find((session) => session.delegation?.parent_session_id === e2e.id);
    assert.ok(e2eChild, 'la delegación que avisa existe');
    const childTools = await runtime.handlers.agent_tools_list({ session_id: e2eChild.id });
    assert.ok(childTools.tools.some((tool) => tool.name === 'agent_wake_parent' && tool.enabled),
      'el agente delegado tiene agent_wake_parent habilitado');
    const parentTools = await runtime.handlers.agent_tools_list({ session_id: e2e.id });
    assert.ok(!parentTools.tools.some((tool) => tool.name === 'agent_wake_parent'),
      'la conversación principal no ofrece una herramienta que solo usa el hijo');

    console.log('[PASS] delegaciones Fase 3a: aviso hijo→padre con tope por ronda, visible como nota, '
      + 'como contexto intermedio en el modelo, reiniciado al retomar, ejecutado por el hijo y oculto al padre.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
