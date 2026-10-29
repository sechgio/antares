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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-rooms-restart-'));
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
  const respond = async (context) => {
    const seen = allText(context);
    const roomTurn = (context.messages || []).some((message) => message.role === 'user'
      && JSON.stringify(message.content).includes('Te toca hablar'));
    if (!roomTurn) return fauxAssistantMessage('Sin turno');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const post = seen.includes('REINICIO_A') ? 'A tras reiniciar' : 'B tras reiniciar';
    return turnCalls(context) < 1
      ? fauxAssistantMessage([fauxToolCall('agent_room', { action: 'post', message: post })], { stopReason: 'toolUse' })
      : fauxAssistantMessage(`Aporté ${post}`);
  };
  faux.setResponses(Array.from({ length: 30 }, () => respond));
  await runtime.open({ dir, storage: await openNodeSqliteStorage(path.join(dir, 'agent.sqlite')), bridge, skipImport: true });
  try {
    await tasks.stop();
    const saved = {};
    for (const name of ['Reinicio A', 'Reinicio B']) {
      ({ profile: saved[name] } = await runtime.handlers.agent_profile_save({ name, instructions: name, tools: null }));
    }
    const { session: parent } = await runtime.handlers.agent_session_create({ provider: 'faux', model: 'faux-1' });
    const delegate = (name, task) => tasks.delegate(saved[name], { agent: saved[name].id, task }, parent.id,
      { taskId: `restart-${name}`, agent: async () => ({ tools: [{ name: 'canvas_list' }] }) }, {});
    const a = await delegate('Reinicio A', 'REINICIO_A: espera el turno');
    const b = await delegate('Reinicio B', 'REINICIO_B: espera el turno');
    const created = await rooms.act({ action: 'create', topic: 'Tras reiniciar', members: [a.session_id, b.session_id],
      rounds: 1, turn_seconds: 60 }, parent.id);
    const state = runtime._internal.state();
    await state.harness.commit(async (tx) => {
      const room = (await tx.doc(state.RoomsDoc)).rooms[created.room_id];
      room.turn.deadline = Date.now() - 60000;
      room.turn.assigned_boot = 'boot-anterior';
    }, state.ctx);
    await rooms.tickRooms(state);
    const resumed = await rooms.act({ action: 'read', room_id: created.room_id }, parent.id);
    assert.equal(resumed.status, 'open', 'la sala sigue abierta tras el arranque');
    assert.equal(resumed.turn.member, a.session_id, 'el turno heredado conserva a su miembro');
    assert.ok(resumed.turn.deadline > Date.now() + 50000, 'el turno recibe una ventana completa al reabrir');
    assert.ok(!resumed.transcript.includes('(TIMEOUT)'), 'la app cerrada no se registra como timeout del miembro');

    await tasks.start();
    await until(async () => (await rooms.act({ action: 'read', room_id: created.room_id }, parent.id)).status === 'closed');
    const closed = await rooms.act({ action: 'read', room_id: created.room_id }, parent.id);
    assert.equal(closed.close_reason, 'completada');
    assert.match(closed.transcript, /Reinicio A: A tras reiniciar/);
    assert.match(closed.transcript, /Reinicio B: B tras reiniciar/);
    assert.ok(!closed.transcript.includes('(TIMEOUT)') && !closed.transcript.includes('(SKIPPED)'),
      'ningún miembro pierde su turno por el tiempo que la app estuvo cerrada');

    console.log('[PASS] salas tras reiniciar: un turno asignado en un arranque anterior recibe una ventana nueva, '
      + 'se reentrega y la sala completa sus turnos sin TIMEOUT ni SKIPPED.');
  } finally {
    await tasks.stop();
    await runtime.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
