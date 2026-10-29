'use strict';

// Cobertura de las rutas de sala que el resto de la suite no ejercita:
// retención de salas cerradas, turno imposible (UNDELIVERED) y miembro ocupado.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');
const { ctx, commitSessions } = require('../electron/agent-shared');

async function until(check, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La espera no terminó a tiempo');
}

function allText(context) {
  return JSON.stringify((context.messages || []).map((message) => message.content));
}

function roomCalls(context) {
  const list = context.messages || [];
  let start = -1;
  list.forEach((message, index) => {
    if (message.role === 'user' && JSON.stringify(message.content).includes('Te toca hablar')) start = index;
  });
  return list.slice(start + 1).flatMap((message) => message.role === 'assistant'
    ? (message.content || []).filter((block) => block.type === 'toolCall' && block.name === 'agent_room') : []).length;
}

async function main() {
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const tasks = require('../electron/agent-tasks');
  const rooms = require('../electron/agent-rooms');
  const execution = require('../electron/agent-execution');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-rooms-coverage-'));
  let reads = 0;
  let holdDispatch = null;
  const gate = () => {
    let release;
    holdDispatch = new Promise((resolve) => { release = resolve; });
    return () => { holdDispatch = null; release(); };
  };
  const bridge = async (method, params) => {
    if (method === 'agent_internal_tools') return { tools: [
      { name: 'canvas_list', kind: 'backend', gated: false, replay_safe: true, inputSchema: { type: 'object', properties: {} } },
    ] };
    if (method === 'agent_internal_dispatch') {
      reads += 1;
      if (holdDispatch) await holdDispatch;
      return { result: JSON.stringify({ documents: ['Comprobante'] }) };
    }
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
  const respond = (context) => {
    const seen = allText(context);
    const roomTurn = seen.includes('Te toca hablar');
    if (!roomTurn && (seen.includes('OCUPADO_B') || seen.includes('GRACE_B'))) {
      return seen.includes('Comprobante')
        ? fauxAssistantMessage('Encargo propio terminado')
        : fauxAssistantMessage([fauxToolCall('canvas_list', { page: 1 })], { stopReason: 'toolUse' });
    }
    if (roomTurn) {
      const label = seen.includes('OCUPADO_A') ? 'Habló A'
        : seen.includes('OCUPADO_B') ? 'Habló B'
          : seen.includes('IMPOSIBLE_C') ? 'Habló C'
            : seen.includes('ERROR_A') || seen.includes('GRACE_A') ? 'Habló A' : '';
      if (!label) return fauxAssistantMessage('Sin turno');
      return roomCalls(context) < 1
        ? fauxAssistantMessage([fauxToolCall('agent_room', { action: 'post', message: label })], { stopReason: 'toolUse' })
        : fauxAssistantMessage(`Aporté ${label}`);
    }
    if (seen.includes('OCUPADO_A') || seen.includes('IMPOSIBLE_C') || seen.includes('ERROR_A')
      || seen.includes('GRACE_A')) {
      return fauxAssistantMessage('Listo');
    }
    return fauxAssistantMessage('Sin turno');
  };
  faux.setResponses(Array.from({ length: 120 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const state = runtime._internal.state();
  const roomText = async (roomId, parentId) => (await rooms.act({ action: 'read', room_id: roomId }, parentId)).transcript;
  try {
    // --- Retención: TTL de 24 h y tope de 50 salas cerradas ---
    const now = Date.now();
    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.RoomsDoc);
      for (let index = 0; index < 52; index += 1) {
        doc.rooms[`vieja-${index}`] = {
          id: `vieja-${index}`, topic: `Sala vieja ${index}`, status: 'closed', parent_session_id: 'fantasma',
          members: ['uno', 'dos'], rounds: 1, round: 1, turn_seconds: 15, log: [], close_reason: 'completada',
          closed_at: index === 0 ? now - 25 * 60 * 60 * 1000 : now - (52 - index) * 1000,
        };
      }
    }, ctx());
    await rooms.tickRooms(state);
    const retained = (await state.harness.snapshot(state.RoomsDoc, ctx())).rooms;
    assert.equal(Object.keys(retained).length, 50, 'la retención deja como máximo 50 salas');
    assert.equal(retained['vieja-0'], undefined, 'una sala cerrada hace 25 h se descarta');
    assert.equal(retained['vieja-1'], undefined, 'por encima de 50 salas se descarta la cerrada más antigua');
    assert.ok(retained['vieja-51'], 'las salas recientes se conservan');
    await state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.RoomsDoc);
      for (const id of Object.keys(doc.rooms)) delete doc.rooms[id];
    }, ctx());

    await tasks.stop();
    const saved = {};
    for (const name of ['Ocupada A', 'Ocupada B', 'Imposible C', 'Imposible D']) {
      ({ profile: saved[name] } = await runtime.handlers.agent_profile_save({ name, instructions: name, tools: null }));
    }
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegate = (name, task, taskId) => tasks.delegate(saved[name],
      { agent: saved[name].id, task }, parent.id,
      { taskId, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) }, {});

    // --- Miembro ocupado: el turno espera a que termine su propio turno ---
    await tasks.start();
    const first = await delegate('Ocupada A', 'OCUPADO_A: prepara el informe', 'coverage-a');
    const releaseBusy = gate();
    const second = await delegate('Ocupada B', 'OCUPADO_B: revisa el anexo', 'coverage-b');
    await until(() => reads > 0);
    const busy = await rooms.act({ action: 'create', topic: 'Miembro ocupado',
      members: [first.session_id, second.session_id], rounds: 1, turn_seconds: 30 }, parent.id);
    await until(async () => /Habló A/.test(await roomText(busy.room_id, parent.id)));
    const waiting = await rooms.act({ action: 'read', room_id: busy.room_id }, parent.id);
    assert.equal(waiting.status, 'open', 'la sala sigue abierta mientras el miembro ocupado no responde');
    assert.ok(!/Habló B/.test(waiting.transcript), 'el turno del miembro ocupado no se adelanta');
    releaseBusy();
    await until(async () => (await messages(parent.id)).messages
      .some((message) => message.notice && message.content === 'Sala «Miembro ocupado» cerrada: completada.'));
    const busyRead = await rooms.act({ action: 'read', room_id: busy.room_id }, parent.id);
    assert.match(busyRead.transcript, /Habló A[\s\S]*Habló B/, 'el miembro ocupado atiende el turno al terminar el suyo');
    const busyMessages = (await messages(second.session_id)).messages;
    const ownAnswer = busyMessages.findIndex((message) => message.content === 'Encargo propio terminado');
    const roomPost = busyMessages.findIndex((message) => (message.tool_calls || []).some((call) => call.name === 'agent_room'));
    assert.ok(ownAnswer !== -1 && roomPost !== -1, 'el miembro ocupado termina su encargo y luego postea');
    assert.ok(ownAnswer < roomPost, 'el turno de la sala no interrumpe el turno en curso del miembro');
    await tasks.stop();

    // --- Plazo: prórroga acotada mientras el miembro sigue ocupado ---
    const graceRelease = gate();
    const graceA = await delegate('Ocupada A', 'GRACE_A: abre la sala', 'coverage-grace-a');
    const graceB = await delegate('Ocupada B', 'GRACE_B: sigue ocupado', 'coverage-grace-b');
    const graceBefore = reads;
    const graceRoom = await rooms.act({ action: 'create', topic: 'Plazo con prórroga',
      members: [graceA.session_id, graceB.session_id], rounds: 1, turn_seconds: 30 }, parent.id);
    await until(async () => /Habló A/.test(await roomText(graceRoom.room_id, parent.id)));
    await until(() => reads > graceBefore);
    const expire = () => state.harness.commit(async (tx) => {
      const doc = await tx.doc(state.RoomsDoc);
      doc.rooms[graceRoom.room_id].turn.deadline = Date.now() - 1;
    }, ctx());
    const graceTurn = async () => (await state.harness.snapshot(state.RoomsDoc, ctx())).rooms[graceRoom.room_id]?.turn || {};
    await expire();
    await rooms.tickRooms(state);
    const firstGrace = await graceTurn();
    assert.equal(firstGrace.grace, 1, 'la primera prórroga queda contada');
    assert.ok(firstGrace.deadline > Date.now(), 'el turno sigue vivo mientras el miembro está ocupado');
    await expire();
    await rooms.tickRooms(state);
    assert.equal((await graceTurn()).grace, 2, 'la segunda prórroga también queda contada');
    await expire();
    await rooms.tickRooms(state);
    const graceRead = await rooms.act({ action: 'read', room_id: graceRoom.room_id }, parent.id);
    assert.match(graceRead.transcript, /\(TIMEOUT\) plazo agotado/, 'sin prórrogas el turno vence con motivo');
    assert.equal(graceRead.status, 'closed', 'la sala cierra cuando se agotan las prórrogas');
    graceRelease();

    // --- Turno imposible: el proveedor del siguiente miembro no arranca ---
    const third = await delegate('Imposible C', 'IMPOSIBLE_C: abre la sala', 'coverage-c');
    const fourth = await delegate('Imposible D', 'IMPOSIBLE_D: nunca arranca', 'coverage-d');
    await commitSessions((map) => { map[fourth.session_id].model = 'unavailable'; });
    const ensureProvider = execution.ensureProvider;
    execution.ensureProvider = async (provider, model) => {
      if (model === 'unavailable') throw new Error('Proveedor temporalmente no disponible');
      return ensureProvider(provider, model);
    };
    try {
      const broken = await rooms.act({ action: 'create', topic: 'Turno imposible',
        members: [third.session_id, fourth.session_id], rounds: 1, turn_seconds: 30 }, parent.id);
      await until(async () => (await messages(parent.id)).messages
        .some((message) => message.notice && message.content === 'Sala «Turno imposible» cerrada: completada.'));
      const brokenRead = await rooms.act({ action: 'read', room_id: broken.room_id }, parent.id);
      assert.match(brokenRead.transcript, /Habló C/, 'el primer miembro sí participó');
      assert.match(brokenRead.transcript, /\(UNDELIVERED\) no se pudo entregar el turno/,
        'el turno que no se pudo entregar queda registrado con su motivo');
      const brokenSummary = (await messages(parent.id)).messages
        .find((message) => String(message.content).startsWith('[Contexto de Antares]\nSala «Turno imposible» cerrada'));
      assert.match(String(brokenSummary?.content || ''), /UNDELIVERED; no se pudo entregar el turno/,
        'el resumen explica por qué se perdió el turno');
      assert.equal(brokenRead.close_reason, 'completada', 'la sala no se queda abierta esperando a un miembro caído');
    } finally {
      execution.ensureProvider = ensureProvider;
    }

    // --- Miembro con error: el fallo se registra como ERROR, no como silencio ---
    const failedA = await delegate('Ocupada A', 'ERROR_A: abre la sala', 'coverage-error-a');
    const failedB = await delegate('Ocupada B', 'ERROR_B: falla el proveedor', 'coverage-error-b');
    const failed = await rooms.act({ action: 'create', topic: 'Miembro con error',
      members: [failedA.session_id, failedB.session_id], rounds: 1, turn_seconds: 30 }, parent.id);
    await commitSessions((map) => {
      map[failedB.session_id].last_error = 'Proveedor caído';
      map[failedB.session_id].delegation.status = 'delivered';
    });
    await until(async () => /Habló A/.test(await roomText(failed.room_id, parent.id)));
    await until(async () => {
      await rooms.tickRooms(state);
      return /\(ERROR\)/.test(await roomText(failed.room_id, parent.id));
    });
    const failedRead = await rooms.act({ action: 'read', room_id: failed.room_id }, parent.id);
    assert.match(failedRead.transcript, /\(ERROR\) error del proveedor: Proveedor caído/,
      'un miembro con error del proveedor no se reporta como silencio');
    assert.equal(failedRead.close_reason, 'completada', 'la sala cierra tras registrar el error');

    console.log('[PASS] cobertura de salas: retención por TTL y tope, miembro ocupado, prórroga de plazo, '
      + 'turno imposible y miembro con error.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
