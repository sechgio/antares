'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const { shared } = require('../electron/agent-shared');

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

const textOf = (content) => typeof content === 'string'
  ? content
  : (content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');

function lastUser(context) {
  const users = (context.messages || []).filter((message) => message.role === 'user');
  return users.length ? textOf(users[users.length - 1].content) : '';
}

function callCount(context, name) {
  return (context.messages || []).flatMap((message) => message.role === 'assistant'
    ? (message.content || []).filter((block) => block.type === 'toolCall' && block.name === name) : []).length;
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const tasks = require('../electron/agent-tasks');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-delegation-phase2-'));
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') return { result: JSON.stringify({ documents: ['Comprobante'] }) };
    if (method === 'agent_internal_dispatch_result') return { result: JSON.stringify({ documents: ['Comprobante'] }) };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    throw new Error(`Puente inesperado: ${method}`);
  };
  const faux = fauxProvider({ models: [{ id: 'faux-1' }, { id: 'faux-2' }] });
  runtime._internal._providerOverrides.set('faux', faux.provider);
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const idle = (id) => until(async () => !(await runtime.handlers.agent_turn_status({ session_id: id })).running);
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const childIn = async (parentId, name) => (await runtime.handlers.agent_sessions_list()).sessions
    .find((session) => session.delegation?.parent_session_id === parentId && session.profile?.name === name);
  const continuoSources = [];
  const parentSources = [];
  const modelSeen = [];
  const respond = (context, _streamOptions, _state, requestModel) => {
    const input = lastUser(context);
    const source = JSON.stringify(context.messages);
    if (input.startsWith(shared.CHECK_MARKER)) return fauxAssistantMessage('');
    if (input.includes('SOLO_CONTINUO')) {
      continuoSources.push(source);
      if (input.includes('SEGUNDA PARTE')) return fauxAssistantMessage('Segunda parte terminada');
      if (callCount(context, 'canvas_list') === 0) return fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' });
      return fauxAssistantMessage('');
    }
    if (input.includes('Retoma y responde CONTINUACIÓN')) {
      continuoSources.push(source);
      return fauxAssistantMessage('Terminé tras la continuación');
    }
    if (input.includes('SOLO_FORK')) {
      modelSeen.push(`${requestModel.provider}/${requestModel.id}`);
      return fauxAssistantMessage('Fork con modelo propio OK');
    }
    if (input.includes('SOLO_DIRECTO')) return fauxAssistantMessage('Informe directo completo');
    if (input.includes('Resultado del agente Directo')) return fauxAssistantMessage('Directo recibido');
    if (input.includes('Delega directo')) {
      return callCount(context, 'agent_delegate') < 4 ? fauxAssistantMessage([fauxToolCall('agent_delegate', {
        agent: direct.id, task: 'SOLO_DIRECTO: comprueba el expediente', max_rounds: 2, idle_minutes: 0,
      })], { stopReason: 'toolUse' }) : fauxAssistantMessage('Delegación directa creada');
    }
    if (input.includes('Resultado del agente Continuo')) {
      parentSources.push(source);
      return fauxAssistantMessage(input.includes('Segunda parte terminada') ? 'Segunda parte recibida' : 'Informe recibido');
    }
    if (input.includes('Resultado del agente Forkeador')) return fauxAssistantMessage('Fork recibido');
    if (input.includes('Delega con continuación')) {
      return callCount(context, 'agent_delegate') < 1 ? fauxAssistantMessage([fauxToolCall('agent_delegate', {
        agent: writer.id, task: 'SOLO_CONTINUO: investiga los documentos',
        max_rounds: 2, idle_minutes: 0, nudge: 'Retoma y responde CONTINUACIÓN',
      })], { stopReason: 'toolUse' }) : fauxAssistantMessage('Delegación creada');
    }
    if (input.includes('Amplía la delegación')) {
      return callCount(context, 'agent_delegate') < 2 ? fauxAssistantMessage([fauxToolCall('agent_delegate', {
        agent: writer.id, task: 'SOLO_CONTINUO: SEGUNDA PARTE', resume: child.id,
      })], { stopReason: 'toolUse' }) : fauxAssistantMessage('Ampliación delegada');
    }
    if (input.includes('Contexto heredado de la conversación principal')) return fauxAssistantMessage('Contexto asimilado');
    if (input.includes('Delega con fork')) {
      return callCount(context, 'agent_delegate') < 3 ? fauxAssistantMessage([fauxToolCall('agent_delegate', {
        agent: forker.id, task: 'SOLO_FORK: revisa lo heredado', fork: true,
      })], { stopReason: 'toolUse' }) : fauxAssistantMessage('Fork delegado');
    }
    return fauxAssistantMessage('Sin encargo');
  };
  let child;
  let writer;
  let forker;
  let direct;
  try {
    ({ profile: writer } = await runtime.handlers.agent_profile_save({
      name: 'Continuo', instructions: 'SOLO_CONTINUO: responde con el resultado del encargo', tools: null,
    }));
    ({ profile: forker } = await runtime.handlers.agent_profile_save({
      name: 'Forkeador', instructions: 'SOLO_FORK: revisa el contexto heredado', tools: null,
      model: { provider: 'faux', model: 'faux-2' },
    }));
    assert.deepEqual(forker.model, { provider: 'faux', model: 'faux-2' }, 'la ficha guarda su modelo propio');
    const { profile: intruder } = await runtime.handlers.agent_profile_save({
      name: 'Intruso', instructions: 'No toca encargos ajenos', tools: null,
    });
    ({ profile: direct } = await runtime.handlers.agent_profile_save({
      name: 'Directo', instructions: 'SOLO_DIRECTO: responde con el resultado del encargo', tools: null,
    }));
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: parent.id, names: ['agent_delegate', 'agent_check', 'canvas_list'] });
    await tasks.stop();
    faux.setResponses(Array.from({ length: 40 }, () => respond));

    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Delega con continuación', request_id: 'p2-continuation' });
    await idle(parent.id);
    child = await childIn(parent.id, 'Continuo');
    assert.ok(child, 'la delegación con continuación existe');
    const delegated = JSON.parse((await messages(parent.id)).messages
      .flatMap((message) => message.tool_calls || []).find((call) => call.name === 'agent_delegate').result);
    assert.equal(delegated.max_rounds, 2);
    assert.equal(delegated.status, 'pending');
    await assert.rejects(tasks.delegate(writer, { agent: writer.id, task: 'otra vez', resume: child.id },
      parent.id, {}, {}), /sigue en marcha/, 'una delegación activa no se retoma');
    await assert.rejects(tasks.delegate(writer, { agent: writer.id, task: 'x', resume: child.id, fork: true },
      parent.id, {}, {}), /no lo combines/);
    await assert.rejects(tasks.delegate(writer, { agent: writer.id, task: 'x', idle_minutes: 2 },
      parent.id, {}, {}), /max_rounds/);
    await assert.rejects(tasks.delegate(writer, { agent: writer.id, task: 'x', max_rounds: 11 },
      parent.id, {}, {}), /entre 1 y 10/);

    await tasks.start();
    await until(async () => (await messages(parent.id)).messages.some((message) => message.content === 'Informe recibido'));
    await idle(parent.id);
    const nudged = (await messages(child.id)).messages
      .find((message) => message.content === 'Continuación automática 1/2 del encargo');
    assert.ok(nudged && nudged.notice, 'el hijo ve el aviso de continuación automática');
    assert.equal(continuoSources.filter((text) => text.includes('Retoma y responde CONTINUACIÓN')).length, 1,
      'el nudge llega una sola vez');
    assert.ok(!continuoSources[0].includes('Retoma y responde CONTINUACIÓN'));
    const nudgedSource = continuoSources[continuoSources.length - 1];
    assert.match(nudgedSource, /Retoma y responde CONTINUACIÓN/);
    assert.match(nudgedSource, /no es una aprobación, un permiso nuevo ni una instrucción del usuario/);
    const delivered = await tasks.checkDelegations({ session_id: child.id }, parent.id);
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.state, 'entregada');
    assert.equal(delivered.rounds, 1);
    assert.equal(delivered.max_rounds, 2);
    assert.ok(parentSources[0].includes('Informe de «Continuo»: completado.'));
    assert.ok(parentSources[0].includes('Terminé tras la continuación'));
    assert.equal((await childIn(parent.id, 'Continuo')).delegation.continuation.rounds, 1);

    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Amplía la delegación', request_id: 'p2-resume' });
    await idle(parent.id);
    await until(async () => (await messages(parent.id)).messages.some((message) => message.content === 'Segunda parte recibida'));
    await idle(parent.id);
    const resumed = (await messages(parent.id)).messages.flatMap((message) => message.tool_calls || [])
      .findLast((call) => call.name === 'agent_delegate');
    assert.equal(JSON.parse(resumed.result).resumed, true);
    assert.equal(JSON.parse(resumed.result).session_id, child.id, 'retomar conserva la conversación hija');
    const sameChild = await childIn(parent.id, 'Continuo');
    assert.equal(sameChild.id, child.id);
    assert.equal(sameChild.delegation.round, 1, 'la ronda cuenta las veces que se retomó');
    assert.equal(sameChild.delegation.continuation.max_rounds, 2, 'retomar conserva la continuación previa');
    assert.equal(sameChild.delegation.continuation.rounds, 0);
    const resumedSource = continuoSources[continuoSources.length - 1];
    assert.ok(resumedSource.includes('Terminé tras la continuación'), 'el hijo retomado conserva su historial');
    assert.ok(resumedSource.includes('Esta es una continuación del encargo en esta misma conversación'));
    assert.ok(parentSources[parentSources.length - 1].includes('Segunda parte terminada'));
    await assert.rejects(tasks.delegate(intruder, { agent: intruder.id, task: 'x', resume: child.id },
      parent.id, {}, {}), /mismo agente/, 'solo el agente original retoma su delegación');

    await runtime.handlers.agent_message_send({ session_id: parent.id,
      content: 'Contexto heredado de la conversación principal', request_id: 'p2-history' });
    await idle(parent.id);
    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Delega con fork', request_id: 'p2-fork' });
    await until(async () => (await messages(parent.id)).messages.some((message) => message.content === 'Fork recibido'));
    await idle(parent.id);
    const forkChild = await childIn(parent.id, 'Forkeador');
    assert.ok(forkChild, 'la delegación con fork existe');
    assert.equal(forkChild.provider, 'faux');
    assert.equal(forkChild.model, 'faux-2', 'el hijo usa el modelo propio de la ficha');
    assert.deepEqual(modelSeen, ['faux/faux-2'], 'la petición del hijo llegó al modelo configurado');
    const forkMessages = (await messages(forkChild.id)).messages;
    assert.ok(forkMessages.some((message) => message.content === 'Contexto heredado de la conversación principal'),
      'fork copia el historial del padre a la conversación hija');
    assert.ok(forkMessages.some((message) => message.content === 'Contexto asimilado'));

    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Delega directo', request_id: 'p2-direct' });
    await until(async () => (await messages(parent.id)).messages.some((message) => message.content === 'Directo recibido'));
    await idle(parent.id);
    const directChild = await childIn(parent.id, 'Directo');
    assert.ok(directChild, 'la delegación con respuesta completa existe');
    assert.ok(!(await messages(directChild.id)).messages
      .some((message) => String(message.content || '').startsWith('Continuación automática')),
    'una respuesta completa no recibe continuación automática');
    const directCheck = await tasks.checkDelegations({ session_id: directChild.id }, parent.id);
    assert.equal(directCheck.status, 'delivered');
    assert.equal(directCheck.rounds, 0, 'no se consumió ninguna reanudación');

    console.log('[PASS] delegaciones Fase 2: continuación automática con nudge, retomar conservando historial, '
      + 'rechazos de resume, fork con contexto heredado y modelo propio, y respuesta completa sin reanudar.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
