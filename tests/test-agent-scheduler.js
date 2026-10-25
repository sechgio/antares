'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const scheduler = require('../electron/agent-tasks');
const { ctx } = require('../electron/agent-shared');

async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La comprobación del planificador no terminó a tiempo');
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-scheduler-'));
  const dbPath = path.join(dir, 'agent.sqlite');
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [] };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: pendingApprovals };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    if (method === 'agent_internal_grants_add') { grants += 1; return { granted: [], rejected: [] }; }
    throw new Error(`Puente inesperado: ${method}`);
  };
  const faux = fauxProvider();
  let grants = 0;
  let pendingApprovals = [];
  runtime._internal._providerOverrides.set('faux', faux.provider);
  try {
    await runtime.open({ dir, storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    const { session } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const future = new Date(Date.now() + 5 * 60000).toISOString();
    const list = async () => (await runtime.handlers.agent_tasks_list({ session_id: session.id })).tasks;

    await assert.rejects(
      runtime.handlers.agent_tasks_save({ session_id: session.id, content: 'Zona inválida', due_at: future, timezone: 'Marte/Olimpo' }),
      /Zona horaria no válida/,
    );
    await assert.rejects(
      runtime.handlers.agent_tasks_save({ session_id: session.id, content: 'Fecha pasada', due_at: new Date(Date.now() - 1000).toISOString() }),
      /debe estar en el futuro/,
    );
    await assert.rejects(
      runtime.handlers.agent_tasks_save({ session_id: session.id, content: 'Repetición inválida', due_at: future, every_minutes: 0 }),
      /repetición mínima/,
    );

    const created = await runtime.handlers.agent_tasks_save({
      session_id: session.id, content: 'Consulta la bandeja de entrada', due_at: future, timezone: 'America/Lima',
    });
    assert.equal(created.scheduled.status, 'pending');
    assert.equal(created.scheduled.timezone, 'America/Lima');
    assert.equal(created.scheduled.silent, false);
    assert.deepEqual(created.scheduled.runs, []);

    const edited = await runtime.handlers.agent_tasks_save({
      session_id: session.id, id: created.scheduled.id, content: 'Consulta la bandeja actualizada',
      due_at: future, every_minutes: 30, timezone: 'America/Lima',
    });
    assert.equal(edited.scheduled.content, 'Consulta la bandeja actualizada');
    assert.equal(edited.scheduled.interval_ms, 30 * 60000);
    assert.equal((await list()).length, 1);

    const contexts = [];
    faux.setResponses([(context) => {
      contexts.push(JSON.stringify(context.messages));
      return fauxAssistantMessage('Bandeja revisada');
    }]);
    await runtime.handlers.agent_tasks_run({ id: created.scheduled.id });
    await until(async () => (await list())[0].runs?.length === 1);
    assert.match(contexts[0], /Consulta la bandeja actualizada/);
    const visibleMessages = (await runtime.handlers.agent_messages_list({ session_id: session.id })).messages;
    assert.ok(visibleMessages.some((message) => message.content.includes('Encargo programado: Consulta la bandeja actualizada')),
      'un encargo visible anuncia su origen');
    const delivered = (await list())[0];
    assert.equal(delivered.status, 'pending', 'un encargo recurrente vuelve a quedar pendiente');
    assert.equal(delivered.runs.at(-1).status, 'delivered');
    assert.equal(delivered.last_status, 'delivered');
    assert.ok(delivered.due_at > Date.now(), 'la siguiente ejecución se reprograma en el futuro');
    assert.equal(delivered.claim_id, undefined, 'el reclamo se libera al entregar');

    const silent = await runtime.handlers.agent_tasks_save({
      session_id: session.id, content: 'Informe silencioso', due_at: future, silent: true,
    });
    let silentContext = '';
    faux.setResponses([(context) => {
      silentContext = JSON.stringify(context.messages);
      return fauxAssistantMessage('Informe listo');
    }]);
    await runtime.handlers.agent_tasks_run({ id: silent.scheduled.id });
    await until(async () => (await list()).find((task) => task.id === silent.scheduled.id)?.status === 'delivered');
    assert.match(silentContext, /Informe silencioso/, 'el silencio no omite el encargo');
    const silentMessages = (await runtime.handlers.agent_messages_list({ session_id: session.id })).messages;
    assert.ok(!silentMessages.some((message) => message.content.includes('Encargo programado: Informe silencioso')),
      'el token de silencio omite el aviso');
    await assert.rejects(
      runtime.handlers.agent_tasks_save({ session_id: session.id, id: silent.scheduled.id, content: 'Cambio tardío', due_at: future }),
      /Solo puedes editar encargos pendientes/,
    );

    await runtime.handlers.agent_tasks_cancel({ id: created.scheduled.id });
    assert.equal((await list()).find((task) => task.id === created.scheduled.id).status, 'cancelled');
    await assert.rejects(runtime.handlers.agent_tasks_run({ id: created.scheduled.id }), /cancelado/);

    await scheduler.stop();
    const state = runtime._internal.state();
    const now = Date.now();
    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.TasksDoc);
      doc.tasks.stale_once = {
        id: 'stale_once', session_id: session.id, content: 'Encargo atascado que no debe repetirse',
        due_at: now - 2000, interval_ms: 0, status: 'delivering', claim_id: 'proceso-anterior',
        claimed_at: now - 1500, created_at: now - 5000, updated_at: now - 1500,
        timezone: 'UTC', silent: false, runs: [],
      };
      doc.tasks.stale_every = {
        id: 'stale_every', session_id: session.id, content: 'Encargo recurrente atascado',
        due_at: now - 90000, interval_ms: 60000, status: 'delivering', claim_id: 'proceso-anterior',
        claimed_at: now - 1500, created_at: now - 5000, updated_at: now - 1500,
        timezone: 'UTC', silent: false, runs: [],
      };
    }, ctx());
    scheduler.start();
    const reconciled = await runtime.handlers.agent_tasks_list({ session_id: session.id });
    const once = reconciled.tasks.find((task) => task.id === 'stale_once');
    const every = reconciled.tasks.find((task) => task.id === 'stale_every');
    assert.equal(once.status, 'uncertain', 'una entrega interrumpida no se repite automáticamente');
    assert.equal(once.runs.at(-1).status, 'uncertain');
    assert.match(once.runs.at(-1).error, /no se repite automáticamente/);
    assert.equal(every.status, 'pending', 'un encargo recurrente se reprograma al reconciliar');
    assert.ok(every.due_at > Date.now());
    assert.equal(every.claim_id, undefined);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const messages = (await runtime.handlers.agent_messages_list({ session_id: session.id })).messages;
    assert.ok(!messages.some((message) => /Encargo atascado|recurrente atascado/.test(message.content)),
      'la reconciliación acota la recuperación y no vuelve a enviar encargos interrumpidos');
    await runtime.handlers.agent_tasks_cancel({ id: 'stale_every' });

    const queueItems = async () => (await runtime.handlers.agent_tasks_list({ session_id: session.id })).tasks
      .filter((task) => task.kind === 'queue')
      .sort((first, second) => first.seq - second.seq);
    const queueState = async () => (await runtime.handlers.agent_tasks_list({ session_id: session.id })).queues
      .find((queue) => queue.session_id === session.id);
    const transcript = async () => (await runtime.handlers.agent_messages_list({ session_id: session.id })).messages;

    const { session: ipcSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const ipcPaused = await runtime.handlers.agent_tasks_queue({ session_id: ipcSession.id, action: 'pause' });
    assert.equal(ipcPaused.queue.paused, true, 'el panel puede pausar la cola por IPC');
    const ipcQueued = await runtime.handlers.agent_tasks_save({ session_id: ipcSession.id, kind: 'queue', content: 'Desde el panel' });
    assert.equal(ipcQueued.scheduled.kind, 'queue');
    assert.equal(ipcQueued.scheduled.status, 'pending');
    assert.deepEqual(ipcQueued.queue, {
      session_id: ipcSession.id, paused: true, paused_reason: 'manual', pending: 1, running: 0,
    });
    await runtime.handlers.agent_tasks_cancel({ id: ipcQueued.scheduled.id });
    const ipcResumed = await runtime.handlers.agent_tasks_queue({ session_id: ipcSession.id, action: 'resume' });
    assert.equal(ipcResumed.queue.paused, false, 'el panel puede reanudar la cola por IPC');

    await scheduler.schedule({ action: 'pause' }, session.id, { taskId: 'queue-pause' });
    const firstQueued = await scheduler.schedule({ action: 'enqueue', content: 'Primero en cola' }, session.id, { taskId: 'queue-turn' });
    const duplicateQueued = await scheduler.schedule({ action: 'enqueue', content: 'Primero en cola' }, session.id, { taskId: 'queue-turn' });
    const secondQueued = await scheduler.schedule({ action: 'enqueue', content: 'Segundo en cola' }, session.id, { taskId: 'queue-turn' });
    assert.equal(duplicateQueued.scheduled.id, firstQueued.scheduled.id, 'reintentar el encolado no duplica el ítem');
    const firstItems = await queueItems();
    assert.deepEqual(firstItems.map((task) => task.content), ['Primero en cola', 'Segundo en cola'],
      'la cola conserva el orden FIFO');
    assert.ok(firstItems[0].seq < firstItems[1].seq);
    assert.equal((await queueState()).paused, true);
    assert.equal((await queueState()).pending, 2);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.ok((await queueItems()).every((task) => task.status === 'pending'), 'una cola pausada no despacha encargos');
    assert.ok(!(await transcript()).some((message) => /Primero en cola|Segundo en cola/.test(message.content)),
      'la cola pausada no envía nada a la conversación');

    const order = [];
    faux.setResponses([
      (context) => {
        order.push('primero');
        assert.match(JSON.stringify(context.messages), /Primero en cola/);
        return fauxAssistantMessage('Primero completado');
      },
      (context) => {
        order.push('segundo');
        assert.match(JSON.stringify(context.messages), /Segundo en cola/);
        return fauxAssistantMessage('Segundo completado');
      },
    ]);
    await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-resume' });
    await until(async () => (await queueItems()).every((task) => task.status === 'delivered'));
    assert.deepEqual(order, ['primero', 'segundo'], 'la cola ejecuta un encargo a la vez y en orden');
    assert.equal(grants, 0, 'un encargo en cola no concede rutas ni permisos');
    assert.deepEqual((await queueItems()).map((task) => task.runs.at(-1).status), ['delivered', 'delivered']);

    const { session: pauseSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const pauseTasks = async () => (await runtime.handlers.agent_tasks_list({ session_id: pauseSession.id })).tasks
      .filter((task) => task.kind === 'queue')
      .sort((first, second) => first.seq - second.seq);
    await scheduler.schedule({ action: 'pause' }, pauseSession.id, { taskId: 'queue-between-setup' });
    const held = await scheduler.schedule({ action: 'enqueue', content: 'Primero retenido' }, pauseSession.id, { taskId: 'queue-between' });
    const waiting = await scheduler.schedule({ action: 'enqueue', content: 'Segundo retenido' }, pauseSession.id, { taskId: 'queue-between' });
    let releaseFirst;
    let firstStarted = false;
    faux.setResponses([
      () => new Promise((resolve) => {
        firstStarted = true;
        releaseFirst = () => resolve(fauxAssistantMessage('Primero retenido terminado'));
      }),
      (context) => {
        assert.match(JSON.stringify(context.messages), /Segundo retenido/);
        return fauxAssistantMessage('Segundo retenido terminado');
      },
    ]);
    await scheduler.schedule({ action: 'resume' }, pauseSession.id, { taskId: 'queue-between-resume' });
    await until(() => firstStarted);
    await scheduler.schedule({ action: 'pause' }, pauseSession.id, { taskId: 'queue-between-pause' });
    releaseFirst();
    await until(async () => (await pauseTasks()).find((task) => task.id === held.scheduled.id)?.status === 'delivered');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal((await pauseTasks()).find((task) => task.id === waiting.scheduled.id)?.status, 'pending',
      'pausar durante un encargo no despacha el siguiente');
    assert.equal((await runtime.handlers.agent_tasks_list({ session_id: pauseSession.id })).queues
      .find((state) => state.session_id === pauseSession.id)?.paused, true);
    assert.ok(!(await runtime.handlers.agent_messages_list({ session_id: pauseSession.id })).messages
      .some((message) => message.content.includes('Segundo retenido')), 'el encargo en espera no se envía hasta reanudar');
    await scheduler.schedule({ action: 'resume' }, pauseSession.id, { taskId: 'queue-between-resume-2' });
    await until(async () => (await pauseTasks()).find((task) => task.id === waiting.scheduled.id)?.status === 'delivered');

    const { session: approvalSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await scheduler.schedule({ action: 'pause' }, approvalSession.id, { taskId: 'queue-approval-pause' });
    const approvalQueued = await scheduler.schedule({ action: 'enqueue', content: 'Espera una aprobación' },
      approvalSession.id, { taskId: 'queue-approval' });
    pendingApprovals = [{ id: 'pendiente' }];
    faux.setResponses([fauxAssistantMessage('Aprobación resuelta')]);
    await scheduler.schedule({ action: 'resume' }, approvalSession.id, { taskId: 'queue-approval-resume' });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal((await runtime.handlers.agent_tasks_list({ session_id: approvalSession.id })).tasks
      .find((task) => task.id === approvalQueued.scheduled.id)?.status, 'pending',
    'una aprobación pendiente bloquea el siguiente encargo de la cola');
    pendingApprovals = [];
    await until(async () => (await runtime.handlers.agent_tasks_list({ session_id: approvalSession.id })).tasks
      .find((task) => task.id === approvalQueued.scheduled.id)?.status === 'delivered');

    await scheduler.schedule({ action: 'pause' }, session.id, { taskId: 'queue-pause-restart' });
    await scheduler.schedule({ action: 'enqueue', content: 'Persistente uno' }, session.id, { taskId: 'queue-restart' });
    await scheduler.schedule({ action: 'enqueue', content: 'Persistente dos' }, session.id, { taskId: 'queue-restart' });
    await runtime.shutdown();
    await runtime.open({ dir, storage: await openNodeSqliteStorage(dbPath), bridge, skipImport: true });
    assert.equal((await queueState()).paused, true, 'la pausa de la cola sobrevive al reinicio');
    assert.deepEqual((await queueItems()).slice(-2).map((task) => task.content), ['Persistente uno', 'Persistente dos'],
      'los encargos en cola conservan su orden tras reiniciar');
    faux.setResponses([
      (context) => {
        assert.match(JSON.stringify(context.messages), /Persistente uno/);
        return fauxAssistantMessage('Persistente uno completado');
      },
      (context) => {
        assert.match(JSON.stringify(context.messages), /Persistente dos/);
        return fauxAssistantMessage('Persistente dos completado');
      },
    ]);
    await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-resume-restart' });
    await until(async () => (await queueItems()).slice(-2).every((task) => task.status === 'delivered'));

    await scheduler.schedule({ action: 'pause' }, session.id, { taskId: 'queue-pause-cancel' });
    const cancelled = await scheduler.schedule({ action: 'enqueue', content: 'Cancelar este' }, session.id, { taskId: 'queue-cancel' });
    const kept = await scheduler.schedule({ action: 'enqueue', content: 'Ejecutar este' }, session.id, { taskId: 'queue-cancel' });
    await runtime.handlers.agent_tasks_cancel({ id: cancelled.scheduled.id });
    faux.setResponses([(context) => {
      assert.match(JSON.stringify(context.messages), /Ejecutar este/);
      return fauxAssistantMessage('Ejecutado tras cancelar');
    }]);
    await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-resume-cancel' });
    await until(async () => (await queueItems()).find((task) => task.id === kept.scheduled.id)?.status === 'delivered');
    assert.equal((await queueItems()).find((task) => task.id === cancelled.scheduled.id)?.status, 'cancelled');
    assert.ok(!(await transcript()).some((message) => message.content.includes('Cancelar este')),
      'un encargo cancelado no se envía nunca');

    await scheduler.schedule({ action: 'pause' }, session.id, { taskId: 'queue-pause-fail' });
    const failing = await scheduler.schedule({ action: 'enqueue', content: 'Fallar en cola' }, session.id, { taskId: 'queue-fail' });
    const afterFailure = await scheduler.schedule({ action: 'enqueue', content: 'No debe ejecutarse aún' }, session.id, { taskId: 'queue-fail' });
    faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Fallo de prueba en cola' })]);
    await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-resume-fail' });
    await until(async () => (await queueItems()).find((task) => task.id === failing.scheduled.id)?.status === 'uncertain'
      && (await queueState()).paused === true);
    assert.equal((await queueState()).paused_reason, 'failed');
    assert.equal((await queueItems()).find((task) => task.id === afterFailure.scheduled.id)?.status, 'pending',
      'un fallo detiene la cola en vez de encadenar el siguiente encargo');
    assert.ok(!(await transcript()).some((message) => message.content.includes('No debe ejecutarse aún')));

    faux.setResponses([(context) => {
      assert.match(JSON.stringify(context.messages), /No debe ejecutarse aún/);
      return fauxAssistantMessage('Reanudado tras el fallo');
    }]);
    await scheduler.schedule({ action: 'resume' }, session.id, { taskId: 'queue-resume-after-fail' });
    await until(async () => (await queueItems()).find((task) => task.id === afterFailure.scheduled.id)?.status === 'delivered');

    const { session: toolSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('task_schedule', { action: 'enqueue', content: 'Encolado desde el turno' }),
        fauxToolCall('task_schedule', { action: 'pause' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('Encolado y pausado'),
    ]);
    await runtime.handlers.agent_message_send({ session_id: toolSession.id, content: 'Encola y pausa el trabajo', request_id: 'queue-tool' });
    await until(async () => !(await runtime.handlers.agent_turn_status({ session_id: toolSession.id })).running);
    const toolMessages = (await runtime.handlers.agent_messages_list({ session_id: toolSession.id })).messages;
    const enqueueCall = toolMessages.flatMap((message) => message.tool_calls || [])
      .find((call) => call.name === 'task_schedule' && call.params.action === 'enqueue');
    assert.equal(enqueueCall.status, 'done', 'el agente puede encolar desde un turno en curso');
    const toolQueued = (await runtime.handlers.agent_tasks_list({ session_id: toolSession.id })).tasks
      .find((task) => task.content === 'Encolado desde el turno');
    assert.equal(toolQueued.kind, 'queue');
    assert.equal(toolQueued.status, 'pending');
    assert.equal((await runtime.handlers.agent_tasks_list({ session_id: toolSession.id })).queues
      .find((state) => state.session_id === toolSession.id)?.paused, true,
    'el agente puede pausar la cola antes de cerrar el turno');
    await runtime.handlers.agent_tasks_cancel({ id: toolQueued.id });

    const { session: capSession } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await scheduler.schedule({ action: 'pause' }, capSession.id, { taskId: 'queue-cap-pause' });
    for (let index = 0; index < 5; index += 1) {
      await scheduler.schedule({ action: 'enqueue', content: `Encargo ${index}` }, capSession.id, { taskId: 'queue-cap-turn' });
    }
    await assert.rejects(
      scheduler.schedule({ action: 'enqueue', content: 'Encargo 5' }, capSession.id, { taskId: 'queue-cap-turn' }),
      /no puede encolar más de 5/,
    );

    console.log('[PASS] Planificador: validación, edición, silencio, historial y entrega única tras reiniciar.');
    console.log('[PASS] Cola FIFO: pausa, reanudación, orden, cancelación, persistencia y pausa automática tras fallo.');
  } finally {
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
