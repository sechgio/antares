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
  const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-scheduler-'));
  const dbPath = path.join(dir, 'agent.sqlite');
  const bridge = async (method) => {
    if (method === 'agent_internal_tools') return { tools: [] };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    if (method === 'agent_internal_grants_add') return { granted: [], rejected: [] };
    throw new Error(`Puente inesperado: ${method}`);
  };
  const faux = fauxProvider();
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
    console.log('[PASS] Planificador: validación, edición, silencio, historial y entrega única tras reiniciar.');
  } finally {
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
