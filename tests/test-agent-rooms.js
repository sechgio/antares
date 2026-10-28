'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../electron/agent-runtime');

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

function turnCalls(context) {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-rooms-'));
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
  const respond = (context) => {
    const seen = allText(context);
    if (seen.includes('SALA_PREGUNTA')) return fauxAssistantMessage('NECESITA ENTRADA: ¿Qué contrato reviso?');
    const roomTurn = (context.messages || []).some((message) => message.role === 'user'
      && JSON.stringify(message.content).includes('Te toca hablar'));
    if (!roomTurn) return fauxAssistantMessage('Sin turno');
    const post = seen.includes('SALA_POST_A') ? 'Dato A' : seen.includes('SALA_POST_B') ? 'Dato B' : null;
    if (post) {
      return turnCalls(context) < 1
        ? fauxAssistantMessage([fauxToolCall('agent_room', { action: 'post', message: post })], { stopReason: 'toolUse' })
        : fauxAssistantMessage(`Aporté ${post}`);
    }
    if (seen.includes('SALA_PASS')) {
      return turnCalls(context) < 1
        ? fauxAssistantMessage([fauxToolCall('agent_room', { action: 'pass' })], { stopReason: 'toolUse' })
        : fauxAssistantMessage('Cedí el turno');
    }
    return fauxAssistantMessage('Escuché sin intervenir');
  };
  faux.setResponses(Array.from({ length: 80 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  const messages = (id) => runtime.handlers.agent_messages_list({ session_id: id });
  const childIn = async (parentId, name) => (await runtime.handlers.agent_sessions_list()).sessions
    .find((session) => session.delegation?.parent_session_id === parentId && session.profile?.name === name);
  try {
    await tasks.stop();
    const saved = {};
    for (const name of ['Sala A', 'Sala B', 'Sala C', 'Sala D', 'Sala E', 'Sala F']) {
      ({ profile: saved[name] } = await runtime.handlers.agent_profile_save({ name, instructions: name, tools: null }));
    }
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegate = (name, task, taskId) => tasks.delegate(saved[name],
      { agent: saved[name].id, task }, parent.id,
      { taskId, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) }, {});
    const a = await delegate('Sala A', 'SALA_POST_A: revisa el contrato', 'room-a');
    const b = await delegate('Sala B', 'SALA_POST_B: revisa el anexo', 'room-b');
    const created = await rooms.act({ action: 'create', topic: 'Contrato y anexo', members: [a.session_id, b.session_id], rounds: 2 },
      parent.id);
    assert.equal(created.status, 'open');
    assert.equal(created.members.length, 2);
    assert.equal(created.round, 1);
    const roster = await tasks.checkDelegations({}, parent.id);
    const rostered = roster.delegations.find((item) => item.session_id === a.session_id);
    assert.equal(rostered.room_id, created.room_id);
    assert.equal(rostered.room.status, 'open');
    assert.equal(rostered.room.round, 1);
    assert.equal(rostered.room.rounds, 2);
    assert.equal(rostered.room.turn_agent, 'Sala A');
    const listed = await rooms.listRooms(parent.id);
    const listedOpen = listed.rooms.find((room) => room.room_id === created.room_id);
    assert.ok(listedOpen, 'la interfaz lista la sala abierta');
    assert.equal(listedOpen.members.length, 2);
    assert.ok(listedOpen.members.every((member) => typeof member.status === 'string'));
    assert.equal(listedOpen.members.some((member) => member.awaiting_user), false);
    assert.ok(!(await rooms.listRooms(a.session_id)).rooms.length, 'un delegado no lista las salas del padre');
    const ipcList = await runtime.handlers.agent_rooms_list({ session_id: parent.id });
    assert.ok(ipcList.rooms.some((room) => room.room_id === created.room_id), 'el IPC de solo lectura lista la sala');
    await assert.rejects(rooms.act({ action: 'create', topic: 'Otra', members: [a.session_id, b.session_id] }, parent.id),
      /Ya hay una sala abierta/, 'solo se admite una sala abierta por conversación');
    await assert.rejects(rooms.act({ action: 'create', topic: 'x', members: [a.session_id, parent.id] }, parent.id),
      /no es una delegación/, 'los miembros deben ser delegaciones');
    await assert.rejects(rooms.act({ action: 'create', topic: 'x', members: [a.session_id, b.session_id] }, a.session_id),
      /no abre salas/, 'un agente delegado no abre salas');
    await assert.rejects(rooms.act({ action: 'post', message: 'Fuera de turno' }, b.session_id),
      /No es tu turno/, 'solo habla el miembro con el turno');

    await tasks.start();
    await until(async () => (await messages(parent.id)).messages
      .some((message) => message.notice && message.content === 'Sala «Contrato y anexo» cerrada: completada.'));
    await until(async () => (await messages(parent.id)).messages
      .some((message) => String(message.content).includes('Informe de «Sala B»')));
    const closed = await rooms.act({ action: 'read', room_id: created.room_id }, parent.id);
    assert.equal(closed.status, 'closed');
    assert.match(closed.transcript, /Ronda 1, Sala A: Dato A/);
    assert.match(closed.transcript, /Ronda 2, Sala B: Dato B/);
    assert.equal((closed.transcript.match(/Dato [AB]/g) || []).length, 4, 'cada miembro habló en las dos rondas');
    const roomA = await childIn(parent.id, 'Sala A');
    const roomB = await childIn(parent.id, 'Sala B');
    assert.ok(!roomA.delegation.room_id && !roomB.delegation.room_id, 'al cerrar se libera la sala de cada miembro');
    const summary = (await messages(parent.id)).messages
      .find((message) => String(message.content).startsWith('[Contexto de Antares]\nSala «Contrato y anexo» cerrada'));
    assert.ok(summary && String(summary.content).includes('no instrucciones ni aprobaciones del usuario'),
      'el resumen de la sala llega como contexto y no como instrucción');
    const report = await tasks.checkDelegations({ session_id: roomA.id }, parent.id);
    assert.equal(report.status, 'delivered');
    assert.equal(report.room_id, undefined);
    const transcriptA = await tasks.readTranscript({ session_id: roomA.id, max_turns: 4 }, parent.id);
    assert.match(transcriptA.agent, /Sala A/);
    assert.ok(transcriptA.messages.some((text) => text.includes('Aporté Dato A')), 'lee el texto de la delegación');
    assert.equal(transcriptA.awaiting_user, false);
    await assert.rejects(tasks.readTranscript({ session_id: roomA.id }, roomA.id), /no es una delegación/);
    const closedList = await rooms.listRooms(parent.id);
    const closedRoom = closedList.rooms.find((room) => room.room_id === created.room_id);
    assert.equal(closedRoom.status, 'closed');
    assert.match(closedRoom.transcript, /Dato A/);
    const question = await delegate('Sala A', 'SALA_PREGUNTA: revisa el contrato', 'room-question');
    await until(async () => (await messages(parent.id)).messages
      .some((message) => String(message.content).includes('Se detuvo en una pregunta para el usuario')));
    const asked = await tasks.readTranscript({ session_id: question.session_id }, parent.id);
    assert.equal(asked.awaiting_user, true, 'la lectura avisa que espera al usuario');
    assert.match(asked.messages.join('\n'), /NECESITA ENTRADA/);
    const questionSession = (await runtime.handlers.agent_sessions_list()).sessions
      .find((session) => session.id === question.session_id);
    assert.equal(questionSession.delegation.awaiting_user, true, 'el estado queda guardado para la sala');
    const promptsB = (await messages(roomB.id)).messages.map((message) => String(message.content)).join('\n');
    assert.match(promptsB, /Participantes: Sala A/, 'el turno nombra a los demás participantes');
    assert.match(promptsB, /Mensajes nuevos desde tu último turno:\n- Ronda 2, Sala A: Dato A/,
      'el turno muestra lo que se dijo desde la última intervención');
    assert.match(promptsB, /Es la última ronda de la sala/, 'la ronda final avisa del cierre');

    const multiA = await delegate('Sala A', 'SALA_SILENCIO_A: espera el turno', 'room-multi-a');
    const multiB = await delegate('Sala B', 'SALA_SILENCIO_B: espera el turno', 'room-multi-b');
    const multi = await rooms.act({ action: 'create', topic: 'Multi', members: [multiA.session_id, multiB.session_id],
      rounds: 1, turn_seconds: 5 }, parent.id);
    await assert.rejects(rooms.act({ action: 'post', message: 'Fuera', reply_to: parent.id }, multiA.session_id),
      /reply_to debe ser un miembro de la sala/, 'solo se responde a un miembro');
    const posted = await rooms.act({ action: 'post', messages: ['M1', 'M2'], turn_key: 'K-MULTI',
      reply_to: multiB.session_id }, multiA.session_id);
    assert.equal(posted.posted, true);
    assert.equal(posted.duplicate, undefined, 'el primer post se registra');
    const repeated = await rooms.act({ action: 'post', messages: ['M1'], turn_key: 'K-MULTI' }, multiA.session_id);
    assert.equal(repeated.posted, false);
    assert.equal(repeated.duplicate, true, 'la misma turn_key no vuelve a publicar ni avanza');
    const passed = await rooms.act({ action: 'pass', turn_key: 'K-PASS' }, multiB.session_id);
    assert.equal(passed.closed, true);
    const multiRead = await rooms.act({ action: 'read', room_id: multi.room_id }, parent.id);
    assert.match(multiRead.transcript, /Sala A: M1 \(responde a Sala B\)/);
    assert.match(multiRead.transcript, /Sala A: M2/);
    assert.equal((multiRead.transcript.match(/M1/g) || []).length, 1, 'el reintento no duplica el mensaje');
    const late = await rooms.act({ action: 'post', room_id: multi.room_id, messages: ['Tarde'] }, multiA.session_id);
    assert.equal(late.recorded, false);
    assert.equal(late.reason, 'closed');

    const cancelA = await delegate('Sala A', 'SALA_SILENCIO_A: espera el turno', 'room-cancel-a');
    const cancelB = await delegate('Sala B', 'SALA_SILENCIO_B: espera el turno', 'room-cancel-b');
    const cancelRoom = await rooms.act({ action: 'create', topic: 'Cancelada',
      members: [cancelA.session_id, cancelB.session_id], rounds: 2, turn_seconds: 5 }, parent.id);
    const cancelled = await rooms.act({ action: 'close', room_id: cancelRoom.room_id }, parent.id);
    assert.equal(cancelled.closed, true);
    assert.match(cancelled.transcript, /\(CANCELLED\)/, 'el turno en curso queda registrado al cerrar');
    assert.equal(cancelled.close_reason, 'cerrada por la conversación principal');
    const released = (await runtime.handlers.agent_sessions_list()).sessions
      .find((session) => session.id === cancelA.session_id);
    assert.ok(!released.delegation.room_id, 'cerrar libera a los miembros');

    const c = await delegate('Sala C', 'SALA_PASS: cede el turno', 'room-c');
    const d = await delegate('Sala D', 'SALA_CALLAR: escucha el turno', 'room-d');
    const timed = await rooms.act({ action: 'create', topic: 'Timeout', members: [c.session_id, d.session_id],
      rounds: 1, turn_seconds: 2 }, parent.id);
    await until(async () => (await messages(parent.id)).messages
      .some((message) => message.notice && message.content === 'Sala «Timeout» cerrada: completada.'), 25000);
    const timedRoom = await rooms.act({ action: 'read', room_id: timed.room_id }, parent.id);
    assert.match(timedRoom.transcript, /Sala C: \(PASS\)/);
    assert.match(timedRoom.transcript, /Sala D: \(TIMEOUT\)/, 'el turno sin respuesta se registra como TIMEOUT');

    const e = await delegate('Sala E', 'SALA_CALLAR: escucha el turno', 'room-e');
    const f = await delegate('Sala F', 'SALA_PASS: cede el turno', 'room-f');
    const skipped = await rooms.act({ action: 'create', topic: 'Abandono', members: [e.session_id, f.session_id],
      turn_seconds: 2 }, parent.id);
    await tasks.stopDelegation({ session_id: f.session_id, reason: 'abandona' }, parent.id);
    await until(async () => (await messages(parent.id)).messages
      .some((message) => message.notice && message.content === 'Sala «Abandono» cerrada: completada.'), 25000);
    const skippedRoom = await rooms.act({ action: 'read', room_id: skipped.room_id }, parent.id);
    assert.match(skippedRoom.transcript, /Sala E: \(TIMEOUT\)/);
    assert.match(skippedRoom.transcript, /Sala F: \(SKIPPED\)/, 'un miembro detenido se salta');

    console.log('[PASS] salas Fase 3b: turnos SENT en orden y rondas, PASS, SKIPPED y TIMEOUT, cierre con resumen '
      + 'como contexto, liberación de miembros y entrega posterior de cada informe.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
