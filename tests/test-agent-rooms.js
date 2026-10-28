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
