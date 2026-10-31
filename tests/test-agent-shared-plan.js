'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const tasks = require('../electron/agent-tasks');
const { conversation, readPlan, savePlan, sessions } = require('../electron/agent-shared');
const projection = require('../electron/agent-projection');

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const report = tasks._internal;
  const plan = report.planBrief({ goal: 'Cerrar el trimestre', steps: [
    { title: 'Revisar el contrato', status: 'done' },
    { title: 'Contrastar el anexo', status: 'in_progress' },
  ] });
  assert.match(plan, /^Plan compartido de la conversación principal \(«Cerrar el trimestre»\):\n/);
  assert.match(plan, /1\. \[hecho\] Revisar el contrato\n2\. \[en curso\] Contrastar el anexo/);
  assert.match(report.delegationBrief({ origin: 'Revisa la factura' }, plan),
    /petición del usuario: «Revisa la factura»[\s\S]*Plan compartido[\s\S]*NECESITA ENTRADA:/,
    'el plan compartido acompaña al encargo');
  assert.equal(report.planBrief(null), '', 'sin plan no se añade contexto');
  const longPlan = report.planBrief({ steps: Array.from({ length: 10 }, (_, index) => ({
    title: `Paso ${index + 1}`, status: 'pending',
  })) });
  assert.match(longPlan, /8\. \[pendiente\] Paso 8/);
  assert.match(longPlan, /\+2 pasos más en el plan/);
  assert.ok(!longPlan.includes('Paso 9'), 'el plan compartido se recorta');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-shared-plan-'));
  const dbPath = path.join(dir, 'agent.sqlite');
  const bridge = async (method, params) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
      { name: 'task_plan', kind: 'backend', gated: false, replay_safe: true, module: 'plan', inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') {
      if (params.name === 'task_plan') {
        return { result: JSON.stringify({ recorded: true, plan: {
          goal: params.params && params.params.goal, steps: (params.params && params.params.steps) || [],
        } }) };
      }
      return { result: JSON.stringify({ documents: ['Contrato'] }) };
    }
    if (method === 'agent_internal_dispatch_result') return { result: JSON.stringify({ recorded: true }) };
    if (method === 'agent_internal_provider') return { style: 'openai_chat', base_url: 'http://unused', api_key: 'test' };
    if (method === 'agent_internal_approvals_pending') return { approvals: [] };
    if (method === 'agent_internal_memory_context') return { context: '' };
    if (method === 'agent_internal_mentions') return { modules: [], unknown: [], ambiguous: [], context: '' };
    if (method === 'agent_internal_artifacts') return { artifacts: [], questions: [], context: {} };
    if (method === 'agent_internal_activity') return { attention: {} };
    if (method === 'agent_internal_profile_usage') return { tokens: 0 };
    throw new Error(`Puente inesperado: ${method}`);
  };
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] });
  runtime._internal._providerOverrides.set('faux', faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('task_plan', { goal: 'Cerrar el trimestre', steps: [
      { title: 'Revisar el contrato', status: 'done', evidence: 'contrato revisado' },
      { title: 'Contrastar el anexo', status: 'in_progress' },
    ] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Plan anotado'),
    fauxAssistantMessage('Informe del hijo'),
    fauxAssistantMessage('Informe del hijo'),
  ]);
  let storage = await openNodeSqliteStorage(dbPath);
  await runtime.open({ dir, storage, bridge, skipImport: true });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const apiFor = (taskId, callId) => ({ taskId, callId, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) });
  try {
    await tasks.stop();
    const { profile } = await runtime.handlers.agent_profile_save({
      name: 'Revisor', instructions: 'Revisa el contrato', tools: null,
    });
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    await runtime.handlers.agent_message_send({ session_id: parent.id, content: 'Organiza el cierre del trimestre' });
    await until(async () => !(await runtime.handlers.agent_turn_status({ session_id: parent.id })).running);
    const planned = await messages(parent.id);
    assert.equal(planned.plan?.goal, 'Cerrar el trimestre', 'el padre publicó el plan');
    const state = runtime._internal.state();
    const stored = await state.harness.snapshot(state.PlanDoc, state.ctx);
    assert.equal(stored.plans[parent.id]?.goal, 'Cerrar el trimestre', 'el plan vigente queda en su documento');
    assert.deepEqual(stored.plans[parent.id].steps.map((step) => step.status), ['done', 'in_progress']);
    assert.equal(stored.plans[parent.id].steps[0].evidence, 'contrato revisado', 'el doc conserva la evidencia canonical');
    assert.equal(typeof stored.plans[parent.id].updated_at, 'number', 'el plan guardado se fecha');

    const warn = console.warn;
    const realCommit = state.harness.commit;
    const realSnapshot = state.harness.snapshot;
    console.warn = () => {};
    try {
      state.harness.commit = async () => { throw new Error('fallo de disco simulado'); };
      assert.equal(await savePlan(parent.id, { goal: 'Cerrar', steps: [
        { title: 'Paso', status: 'pending' },
      ] }), false, 'un guardado fallido se informa al llamador');
      state.harness.commit = realCommit;
      state.harness.snapshot = async () => { throw new Error('fallo de lectura simulado'); };
      assert.equal(await readPlan(parent.id), null, 'una lectura fallida no escala al chat');
    } finally {
      state.harness.commit = realCommit;
      state.harness.snapshot = realSnapshot;
      console.warn = warn;
    }

    const delegated = await tasks.delegate(profile, { agent: profile.id, task: 'Revisa el contrato' },
      parent.id, apiFor('plan-turno-1', 'call-1'), {});
    const child = (await sessions())[delegated.session_id];
    await tasks.startChild(child);
    const brief = JSON.stringify(await projection.allEntries(await conversation(child.id)));
    assert.match(brief, /Plan compartido de la conversación principal/, 'el encargo recibe el plan vigente');
    assert.match(brief, /Cerrar el trimestre/, 'el plan conserva su meta');
    assert.match(brief, /1\. \[hecho\] Revisar el contrato/);
    assert.match(brief, /2\. \[en curso\] Contrastar el anexo/);
    assert.match(brief, /Sitúa tu encargo dentro de ese plan/);
    await until(async () => !(await runtime.handlers.agent_turn_status({ session_id: child.id })).running);

    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.PlanDoc);
      doc.plans[child.id] = {
        goal: 'Plan del hijo',
        steps: [{ title: 'Contrastar el anexo', status: 'done', evidence: 'anexo contrastado' }],
        updated_at: Date.now(),
      };
      doc.plans[parent.id] = {
        goal: 'Cerrar el trimestre',
        steps: [{ title: 'Contrastar el anexo', status: 'done', evidence: 'anexo contrastado' }],
        updated_at: Date.now() + 1000,
      };
    }, state.ctx);
    const reread = await runtime.latestPlan(parent.id);
    assert.equal(reread.steps[1].status, 'in_progress', 'el historial nuevo gana al doc guardado');
    const fallback = await runtime.latestPlan(child.id);
    assert.equal(fallback.goal, 'Plan del hijo', 'el doc cubre una conversación sin task_plan');
    assert.equal(fallback.steps[0].status, 'done');

    await runtime.shutdown();
    storage = await openNodeSqliteStorage(dbPath);
    await runtime.open({ dir, storage, bridge, skipImport: true });
    await tasks.stop();
    const reopened = await messages(parent.id);
    assert.equal(reopened.plan?.steps[1]?.status, 'in_progress', 'el plan sobrevive al reinicio y el historial manda');
    const reopenedState = runtime._internal.state();

    await runtime.handlers.agent_session_delete({ id: parent.id });
    const afterDelete = await reopenedState.harness.snapshot(reopenedState.PlanDoc, reopenedState.ctx);
    assert.equal(afterDelete.plans[parent.id], undefined, 'el borrado elimina el plan');

    console.log('[PASS] plan compartido: el historial es la fuente de verdad, el doc cubre la conversación sin '
      + 'task_plan, el plan sobrevive al reinicio y el borrado limpia su documento.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
