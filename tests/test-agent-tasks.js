'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');

async function until(check) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('El encargo no terminó a tiempo');
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-scheduled-'));
  const dbPath = path.join(dir, 'agent.sqlite');
  const granted = [];
  let slow = false;
  let reads = 0;
  const bridge = async (method, params) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
      { name: 'fs_write', kind: 'backend', gated: true, inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') { reads += 1; return { result: slow ? null : JSON.stringify({ documents: ['Comprobante'] }) }; }
    if (method === 'agent_internal_dispatch_result') return { result: slow ? null : JSON.stringify({ documents: ['Comprobante'] }) };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    if (method === 'agent_internal_grants_add') { granted.push(params); return { granted: [], rejected: [] }; }
    throw new Error(`Puente inesperado: ${method}`);
  };
  const open = async () => {
    const faux = fauxProvider();
    runtime._internal._providerOverrides.set('faux', faux.provider);
    await runtime.open({ dir, storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    return faux;
  };
  const idle = (id) => until(async () => !(await runtime.handlers.agent_turn_status({ session_id: id })).running);
  try {
    let faux = await open();
    const { profile: initialProfile } = await runtime.handlers.agent_profile_save({ name: 'Inicial', instructions: 'Lee el encargo', tools: null });
    const { session: initialSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'list' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Sin encargos'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: initialSession.id, content: 'Lista mis encargos', request_id: 'empty-tasks' });
    await idle(initialSession.id);
    const emptyListing = (await runtime.handlers.agent_messages_list({ session_id: initialSession.id })).messages
      .flatMap((message) => message.tool_calls || []).find((call) => call.name === 'task_schedule');
    assert.equal(emptyListing.status, 'done', 'la consulta de un catálogo vacío debe terminar correctamente');
    assert.deepEqual(JSON.parse(emptyListing.result).tasks, [], 'el catálogo vacío se puede consultar sin materializar TasksDoc');
    await require('../electron/agent-tasks').stop();
    const tasksModule = require('../electron/agent-tasks');
    const { profile: reviewerProfile } = await runtime.handlers.agent_profile_save({
      name: 'Revisor', instructions: 'Revisa la evidencia', tools: null, role: 'reviewer',
    });
    const { profile: workerProfile } = await runtime.handlers.agent_profile_save({
      name: 'Operador', instructions: 'Ejecuta cambios', tools: null, role: 'worker',
    });
    assert.equal(reviewerProfile.role, 'reviewer');
    assert.equal(workerProfile.role, 'worker');
    await assert.rejects(
      runtime.handlers.agent_profile_save({ name: 'Inválido', instructions: 'x', tools: null, role: 'admin' }),
      /Rol de agente no válido/,
    );
    const delegateApi = {
      taskId: 'exclusion-v2',
      agent: async () => ({ tools: [{ name: 'canvas_list' }, { name: 'fs_write' }] }),
    };
    await assert.rejects(
      tasksModule.delegate(workerProfile, { task: 'Modifica el documento' }, initialSession.id, delegateApi, {}),
      /worker solo se delega con subagent_run/,
    );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      tasksModule.delegate(reviewerProfile, { task: 'Revisa el comprobante', exclude_tools: ['canvas_list'] },
        initialSession.id, delegateApi, { abortSignal: aborted.signal }),
      /cancelado/,
    );
    const reviewChild = (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.delegation?.parent_session_id === initialSession.id && item.title === 'Delegación: Revisor');
    assert.ok(reviewChild, 'la delegación crea la conversación hija antes de cancelarse');
    assert.equal(reviewChild.delegation.depth, 1);
    const reviewTools = await runtime.handlers.agent_tools_list({ session_id: reviewChild.id });
    assert.ok(!reviewTools.tools.some((tool) => tool.name === 'canvas_list' && tool.enabled),
      'exclude_tools sustrae la herramienta del hijo');
    await assert.rejects(
      tasksModule.delegate(reviewerProfile, { task: 'Delega otra vez' }, reviewChild.id,
        { ...delegateApi, taskId: 'depth-v2' }, {}),
      /profundidad máxima/,
    );
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('agent_delegate', { agent: initialProfile.id, task: 'Comprueba el arranque vacío' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Delegado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: initialSession.id, content: 'Delega la comprobación', request_id: 'empty-delegate' });
    await idle(initialSession.id);
    faux.setResponses([fauxAssistantMessage('Arranque comprobado'), fauxAssistantMessage('Recibí la comprobación inicial')]);
    require('../electron/agent-tasks').start();
    await until(async () => (await runtime.handlers.agent_messages_list({ session_id: initialSession.id })).messages
      .some((message) => message.content === 'Recibí la comprobación inicial'));
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const scheduled = { action: 'create', content: 'Consulta C:\\fuera\\dato.txt sin ampliar accesos', due_at: new Date(Date.now() + 2500).toISOString() };
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_schedule', scheduled)], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Programado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Programa la consulta', request_id: 'schedule-request' });
    await idle(session.id);
    await runtime.shutdown();
    faux = await open();
    let delivered = 0;
    faux.setResponses([(context) => {
      assert.match(JSON.stringify(context.messages), /Encargo programado por el usuario/);
      delivered += 1;
      return fauxAssistantMessage('Consulta programada finalizada');
    }]);
    await until(() => delivered === 1);
    await idle(session.id);
    assert.equal(granted.length, 0, 'un encargo del modelo no autoriza las rutas que contiene');
    await runtime.shutdown();
    faux = await open();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'list' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Consultado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Consulta mis encargos', request_id: 'list-request' });
    await idle(session.id);
    let { messages } = await runtime.handlers.agent_messages_list({ session_id: session.id });
    const listing = messages.flatMap((message) => message.tool_calls || []).findLast((call) => call.name === 'task_schedule');
    assert.equal(JSON.parse(listing.result).tasks[0].status, 'delivered', 'reiniciar no vuelve a entregar un encargo entregado');
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'create', content: 'No ejecutar', due_at: new Date(Date.now() + 60000).toISOString(), every_minutes: 5 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Creado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Programa otro', request_id: 'another' });
    await idle(session.id);
    ({ messages } = await runtime.handlers.agent_messages_list({ session_id: session.id }));
    const created = messages.flatMap((message) => message.tool_calls || []).findLast((call) => call.name === 'task_schedule');
    const task = JSON.parse(created.result).scheduled;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'cancel', id: task.id })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('task_schedule', { action: 'list' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Cancelado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Cancela ese encargo', request_id: 'cancel-request' });
    await idle(session.id);
    ({ messages } = await runtime.handlers.agent_messages_list({ session_id: session.id }));
    const cancelled = messages.flatMap((message) => message.tool_calls || []).findLast((call) => call.name === 'task_schedule');
    assert.equal(JSON.parse(cancelled.result).tasks.find((item) => item.id === task.id).status, 'cancelled');
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Auditor', instructions: 'SOLO_AUDITOR_PERSISTENTE: consulta Canvas y cita el comprobante', tools: null,
    });
    await runtime.handlers.agent_tools_set({ session_id: session.id, names: ['tools_load', 'canvas_list'] });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('tools_load', { modules: ['agent'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Herramientas de encargos cargadas'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Carga las herramientas de encargos', request_id: 'load-agent' });
    await idle(session.id);
    const enabled = (await runtime.handlers.agent_tools_list({ session_id: session.id })).tools.filter((tool) => tool.enabled);
    assert.ok(enabled.some((tool) => tool.name === 'task_schedule'), 'las conversaciones existentes pueden cargar programación');
    assert.ok(enabled.some((tool) => tool.name === 'agent_delegate'), 'las conversaciones existentes pueden cargar delegación');
    assert.ok(enabled.some((tool) => tool.name === 'wait_event'), 'las conversaciones existentes pueden cargar esperas');
    await require('../electron/agent-tasks').stop();
    const respond = (context) => {
      const source = JSON.stringify(context.messages);
      if (source.includes('SOLO_AUDITOR_PERSISTENTE')) {
        if (!source.includes('"role":"toolResult"')) return fauxAssistantMessage([
          fauxToolCall('canvas_list', {}),
        ], { stopReason: 'toolUse' });
        return fauxAssistantMessage('Hallazgo verificado: Comprobante');
      }
      if (source.includes('Resultado del agente Auditor')) return fauxAssistantMessage('Recibí el hallazgo del Auditor');
      if (source.includes('"toolName":"agent_delegate"')) return fauxAssistantMessage('Encargo entregado al Auditor');
      return fauxAssistantMessage([fauxToolCall('agent_delegate', { agent: profile.id, task: 'Consulta y verifica los documentos' })], { stopReason: 'toolUse' });
    };
    faux.setResponses(Array.from({ length: 12 }, () => respond));
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Delega la investigación', request_id: 'delegate' });
    await idle(session.id);
    const child = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.title === 'Delegación: Auditor');
    assert.ok(child, 'la delegación crea una conversación visible');
    await idle(child.id);
    await runtime.shutdown();
    faux = await open();
    faux.setResponses(Array.from({ length: 8 }, () => respond));
    await until(async () => (await runtime.handlers.agent_messages_list({ session_id: session.id })).messages
      .some((message) => message.content === 'Recibí el hallazgo del Auditor'));
    await idle(session.id);
    const childMessages = await runtime.handlers.agent_messages_list({ session_id: child.id });
    assert.ok(childMessages.messages.some((message) => message.content === 'Hallazgo verificado: Comprobante'));
    assert.ok(!childMessages.messages.some((message) => message.content === 'Programa la consulta'), 'la hija no hereda el chat del padre');
    await runtime.handlers.agent_tools_set({ session_id: child.id, names: ['fs_write'] });
    await runtime.handlers.agent_session_permissions_set({ id: child.id, permission_mode: 'full' });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('fs_write', { path: 'fuera.txt', content: 'No escribir' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('La delegación conserva solo lectura'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: child.id, content: 'Intenta escribir', request_id: 'escalation' });
    await idle(child.id);
    const protectedChild = await runtime.handlers.agent_messages_list({ session_id: child.id });
    const blocked = protectedChild.messages.flatMap((message) => message.tool_calls || []).find((call) => call.name === 'fs_write');
    assert.equal(blocked.status, 'denied', 'ni Acceso completo ni habilitar una herramienta amplían los permisos de la delegación');
    await require('../electron/agent-tasks').stop();
    const { session: cancelledParent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_tools_set({ session_id: cancelledParent.id, names: ['agent_delegate', 'canvas_list'] });
    faux.setResponses(Array.from({ length: 6 }, () => respond));
    await runtime.handlers.agent_message_send({ session_id: cancelledParent.id, content: '@Auditor verifica los documentos', request_id: 'delegate-cancel' });
    await idle(cancelledParent.id);
    const cancelledChild = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.title === 'Delegación: Auditor' && item.id !== child.id);
    assert.ok(cancelledChild);
    assert.equal((await runtime.handlers.agent_turn_cancel({ session_id: cancelledParent.id })).cancelled, true,
      'detener al padre también cancela una delegación pendiente aunque el padre esté inactivo');
    await runtime.shutdown();
    faux = await open();
    faux.setResponses(Array.from({ length: 6 }, () => respond));
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal((await runtime.handlers.agent_messages_list({ session_id: cancelledChild.id })).messages.length, 0,
      'una delegación cancelada no arranca tras reiniciar');
    assert.ok(!(await runtime.handlers.agent_messages_list({ session_id: cancelledParent.id })).messages
      .some((message) => message.content === 'Recibí el hallazgo del Auditor'));
    await require('../electron/agent-tasks').stop();
    const { session: isolatedParent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('agent_delegate', { agent: profile.id, task: 'Primer encargo: proveedor no disponible' }),
        fauxToolCall('agent_delegate', { agent: profile.id, task: 'Segundo encargo: consulta Canvas' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Encargos delegados'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: isolatedParent.id, content: 'Delega ambas consultas', request_id: 'isolated' });
    await idle(isolatedParent.id);
    const unavailable = (await runtime.handlers.agent_sessions_list()).sessions
      .find((item) => item.delegation?.content === 'Primer encargo: proveedor no disponible');
    await runtime.handlers.agent_session_model_set({ id: unavailable.id, provider: 'faux', model: 'unavailable' });
    const execution = require('../electron/agent-execution');
    const ensureProvider = execution.ensureProvider;
    let failedStarts = 0;
    execution.ensureProvider = async (provider, model) => {
      if (model === 'unavailable') { failedStarts += 1; throw new Error('Proveedor temporalmente no disponible'); }
      return ensureProvider(provider, model);
    };
    try {
      faux.setResponses(Array.from({ length: 8 }, () => respond));
      require('../electron/agent-tasks').start();
      await until(async () => (await runtime.handlers.agent_messages_list({ session_id: isolatedParent.id })).messages
        .some((message) => message.content === 'Recibí el hallazgo del Auditor'));
      assert.equal(failedStarts, 1, 'un proveedor caído no bloquea otras delegaciones ni se reintenta cada segundo');
    } finally {
      await require('../electron/agent-tasks').stop();
      execution.ensureProvider = ensureProvider;
      await runtime.handlers.agent_turn_cancel({ session_id: unavailable.id });
      require('../electron/agent-tasks').start();
    }
    slow = true;
    const previousReads = reads;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('canvas_list', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Primer encargo completo'),
      (context) => {
        assert.match(JSON.stringify(context.messages), /Segundo encargo durable/);
        return fauxAssistantMessage('Segundo encargo completo');
      },
    ]);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Primero consulta Canvas', request_id: 'busy-first' });
    await until(() => reads > previousReads);
    await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Segundo encargo durable', request_id: 'busy-second' });
    const duplicate = await runtime.handlers.agent_message_send({ session_id: session.id, content: 'Segundo encargo durable', request_id: 'busy-second' });
    assert.equal(duplicate.duplicate, true, 'reintentar el envío no duplica el mensaje en cola');
    slow = false;
    await idle(session.id);
    const queued = await runtime.handlers.agent_messages_list({ session_id: session.id });
    assert.equal(queued.messages.filter((message) => message.content === 'Segundo encargo durable').length, 1);
    assert.ok(queued.messages.some((message) => message.content === 'Segundo encargo completo'));
    await require('../electron/agent-tasks').stop();
    const { session: longParent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('agent_delegate', { agent: profile.id, task: 'Investiga todos los documentos' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Encargo largo delegado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: longParent.id, content: 'Delega una investigación larga', request_id: 'long-parent' });
    await idle(longParent.id);
    const longJob = (await runtime.handlers.agent_sessions_list()).sessions.find((item) => item.delegation?.parent_session_id === longParent.id);
    faux.setResponses([
      ...Array.from({ length: 40 }, (_, page) => fauxAssistantMessage([
        fauxToolCall('canvas_list', { page }),
      ], { stopReason: 'toolUse' })),
      fauxAssistantMessage('Llegué al presupuesto de este turno'),
    ]);
    require('../electron/agent-tasks').start();
    await until(async () => (await runtime.handlers.agent_messages_list({ session_id: longJob.id })).resumable);
    await idle(longJob.id);
    const parked = await runtime.handlers.agent_messages_list({ session_id: longJob.id });
    assert.equal(parked.resumable, true, 'el presupuesto crea una continuación incluso sin un task_plan');
    assert.ok(parked.messages.some((message) => /punto de continuación/.test(message.content)));
    assert.equal((await runtime.activitySnapshot()).find((item) => item.id === longJob.id).status, 'waiting_input');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok(!(await runtime.handlers.agent_messages_list({ session_id: longParent.id })).messages
      .some((message) => /devolvió su encargo/.test(message.content)), 'una delegación aparcada no se entrega como terminada');
    await runtime.shutdown();
    faux = await open();
    const restored = await runtime.handlers.agent_messages_list({ session_id: longJob.id });
    assert.equal(restored.resumable, true, 'el punto de continuación sobrevive al reinicio');
    faux.setResponses([
      fauxAssistantMessage('Investigación completada tras reanudar'),
      fauxAssistantMessage('Recibí la investigación completa'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: longJob.id, content: 'Continúa el encargo pendiente', request_id: 'resume-long' });
    await idle(longJob.id);
    assert.equal((await runtime.handlers.agent_messages_list({ session_id: longJob.id })).resumable, false,
      'una continuación completada deja de ofrecer reanudación');
    await until(async () => (await runtime.handlers.agent_messages_list({ session_id: longParent.id })).messages
      .some((message) => message.content === 'Recibí la investigación completa'));
    console.log('[PASS] Encargos SQLite: reinicio, entrega única, cancelación y permisos de rutas.');
    console.log('[PASS] Delegación SQLite: persistencia, devolución tras reinicio, cancelación y solo lectura.');
    console.log('[PASS] Un proveedor caído no bloquea otras delegaciones.');
    console.log('[PASS] Una conversación ocupada admite un segundo encargo sin duplicarlo.');
    console.log('[PASS] El presupuesto conserva una continuación reanudable tras reiniciar.');
  } finally {
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
