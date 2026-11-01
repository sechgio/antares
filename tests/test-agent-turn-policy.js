'use strict';

const assert = require('node:assert/strict');
const policy = require('../electron/agent-turn-policy');

function successful() {
  return { model: [{ isError: false }], data: {} };
}

function failed(diagnostics) {
  return { model: [{ isError: true }], data: { diagnostics } };
}

function apiFor(...entries) {
  return { entry: async (id) => entries[id] };
}

async function main() {
  {
    const turn = { silentTurns: 4, pendingSilent: true, roundProgress: true };
    policy.trackSilentTurn({ content: [{ type: 'text', text: 'Listo' }], stopReason: 'stop' }, turn, true);
    assert.equal(turn.silentTurns, 0);
    assert.equal(turn.pendingSilent, false);
  }
  {
    const turn = { silentTurns: 1, pendingSilent: false, roundProgress: true };
    policy.trackSilentTurn({ content: [{ type: 'toolCall' }], stopReason: 'toolUse' }, turn, false);
    assert.equal(turn.silentTurns, 1);
    assert.equal(turn.pendingSilent, true);
    assert.equal(turn.roundProgress, false);
  }
  {
    const turn = { silentTurns: 0, pendingSilent: false, roundProgress: false };
    policy.trackSilentTurn({ content: [], stopReason: 'stop' }, turn, false);
    policy.trackSilentTurn({ content: [], stopReason: 'length' }, turn, false);
    assert.equal(turn.silentTurns, 2);
    policy.trackSilentTurn({ content: [], stopReason: 'error', errorMessage: 'fallo' }, turn, false);
    policy.trackSilentTurn({ content: [], stopReason: 'aborted' }, turn, false);
    assert.equal(turn.silentTurns, 2);
  }
  {
    const message = { content: [], stopReason: 'stop' };
    const turn = { silentTurns: policy.MAX_SILENT_TURNS - 1, pendingSilent: false, roundProgress: false };
    policy.trackSilentTurn(message, turn, false);
    assert.equal(turn.silentTurns, policy.MAX_SILENT_TURNS);
    assert.equal(message.stopReason, 'error');
    assert.match(message.errorMessage, /turnos seguidos sin salida visible/);
    assert.deepEqual(message.content.at(-1), { type: 'text', text: message.errorMessage });
  }
  {
    const turn = { silentTurns: 1, pendingSilent: false, roundProgress: false };
    const api = { entry: async () => { throw new Error('no debió consultarse'); } };
    await policy.trackSilentToolRound(turn, [0], api, {});
    assert.equal(turn.silentTurns, 1);
  }
  {
    const turn = { silentTurns: 2, pendingSilent: true, roundProgress: true };
    await policy.trackSilentToolRound(turn, [0], apiFor(successful()), {});
    assert.equal(turn.silentTurns, 0);
    assert.equal(turn.pendingSilent, false);
    assert.equal(turn.roundProgress, false);
  }
  {
    const turn = { silentTurns: 2, pendingSilent: true, roundProgress: false };
    await policy.trackSilentToolRound(turn, [0], apiFor(failed([{ code: 'blocked' }])), {});
    assert.equal(turn.silentTurns, 3);
  }
  {
    const turn = { silentTurns: 2, pendingSilent: true, roundProgress: false };
    await policy.trackSilentToolRound(turn, [0], apiFor(failed([{ code: 'denied' }])), {});
    assert.equal(turn.silentTurns, 0);
  }
  {
    const turn = { silentTurns: 2, pendingSilent: true, roundProgress: false };
    const api = { entry: async () => { throw new Error('entrada no disponible'); } };
    const original = console.error;
    console.error = () => {};
    try {
      await policy.trackSilentToolRound(turn, [0], api, {});
    } finally {
      console.error = original;
    }
    assert.equal(turn.silentTurns, 0);
  }

  console.log('[PASS] agent-turn-policy: política de silencio y rondas de herramientas');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
