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
  const { conversation, ctx } = require('../electron/agent-shared');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-hooks-'));
  const previousHome = process.env.AGENTS_HOME;
  process.env.AGENTS_HOME = dir;
  fs.mkdirSync(path.join(dir, 'hooked'));
  fs.writeFileSync(path.join(dir, 'hooked/agent.json'), JSON.stringify({
    name: 'Perfil con hooks', slug: 'hooked', model: 'faux-1', description: 'Declara contexto por evento',
  }));
  fs.writeFileSync(path.join(dir, 'hooked/AGENTS.md'), 'Rol: revisar. Tono: claro.');
  fs.writeFileSync(path.join(dir, 'hooked/hooks.json'), JSON.stringify({ hooks: [
    { event: 'subagentStart', context: 'HOOK_INICIO: revisa el contrato antes de delegar.' },
    { event: 'subagentStop', context: 'HOOK_FIN: cita la evidencia al cerrar.' },
    { event: 'preToolUse', context: 'HOOK_PRE: confirma el ámbito de la consulta.', tools: ['canvas_list'] },
    { event: 'postToolUse', context: 'HOOK_POST: anota el resultado consultado.', tools: ['canvas_list'] },
    { event: 'preToolUse', context: 'HOOK_OTRO: solo para otra herramienta.', tools: ['otra_tool'] },
  ] }));
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
  const deliveryInputs = [];
  const respond = (context) => {
    const input = lastUser(context);
    if (input.includes('HOOK_INICIO')) return fauxAssistantMessage('Informe del hijo');
    if (input.includes('HOOK_FIN')) {
      deliveryInputs.push(input);
      return fauxAssistantMessage('Informe con contexto de cierre recibido');
    }
    if (input.includes('HOOKS: consulta el contrato')) {
      return callCount(context, 'canvas_list') < 1
        ? fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' })
        : fauxAssistantMessage('Consulta terminada');
    }
    return fauxAssistantMessage('Respuesta sin hooks');
  };
  faux.setResponses(Array.from({ length: 20 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const api = { taskId: 'hooks-turno-1', callId: 'call-hooks-1' };
  api.agent = async () => ({ tools: [{ name: 'canvas_list' }] });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  try {
    await tasks.stop();
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Trazador', instructions: 'Revisa el contrato y devuelve evidencia', tools: null,
    });
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', profile_id: 'hooked' });
    assert.equal(parent.model, 'faux-1', 'el perfil portable aporta su modelo');
    await runtime.handlers.agent_tools_set({ session_id: parent.id, names: ['canvas_list'] });

    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'HOOKS: consulta el contrato' });
    const parentConv = await conversation(parent.id);
    await parentConv.waitForIdle(ctx());
    const toolResults = (await parentConv.entries({}, 200, undefined, ctx())).items
      .filter((entry) => entry.kind === 'pi.tool-result').flatMap((entry) => entry.model);
    const toolResult = toolResults.find((result) => result.toolName === 'canvas_list');
    assert.ok(toolResult, 'la consulta se ejecutó');
    const texts = toolResult.content.filter((block) => block.type === 'text').map((block) => block.text);
    assert.match(texts[0], /HOOK_PRE/, 'el contexto previo abre el resultado de la herramienta');
    assert.ok(texts.some((text) => text.includes('Contrato')), 'el resultado real se conserva');
    assert.match(texts.at(-1), /HOOK_POST/, 'el contexto posterior cierra el resultado');
    const rendered = JSON.stringify(toolResult);
    assert.ok(!rendered.includes('HOOK_OTRO'), 'un hook de otra herramienta no se aplica');
    assert.ok(!rendered.includes('HOOK_INICIO'), 'los hooks de delegación no se mezclan con el uso de herramientas');

    const delegated = await tasks.delegate(profile, { agent: profile.id, task: 'HOOKS: revisa el contrato' },
      parent.id, api, {});
    const childConv = await conversation(delegated.session_id);
    await tasks.start();
    await until(async () => (await tasks.checkDelegations({ session_id: delegated.session_id }, parent.id)).status === 'delivered');
    const childEntries = (await childConv.entries({}, 100, undefined, ctx())).items;
    assert.ok(JSON.stringify(childEntries).includes('HOOK_INICIO'),
      'el hijo recibe el contexto declarado al iniciar la delegación');
    assert.ok(!JSON.stringify(childEntries).includes('HOOK_OTRO'));

    await until(async () => (await messages(parent.id)).messages
      .some((message) => message.content === 'Informe con contexto de cierre recibido'));
    assert.equal(deliveryInputs.length, 1, 'el padre procesa una entrega');
    assert.match(deliveryInputs[0], /HOOK_FIN/, 'el cierre añade el contexto declarado al resultado del hijo');
    assert.ok(deliveryInputs[0].includes('Informe del hijo'), 'el informe del hijo llega completo');
    assert.ok(!deliveryInputs[0].includes('HOOK_OTRO'));

    console.log('[PASS] hooks declarativos Fase 4b: hooks.json validado en el perfil portable, contexto de inicio '
      + 'en el encargo del hijo, de cierre en la entrega al padre y previo/posterior acotados por herramienta, '
      + 'sin ejecutar código ni conceder permisos.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    runtime._internal._providerOverrides.delete('faux');
    if (previousHome === undefined) delete process.env.AGENTS_HOME;
    else process.env.AGENTS_HOME = previousHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
