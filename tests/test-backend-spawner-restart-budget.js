const {
  assert, finish, flushAsyncTurns, waitFor, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner restart budget exhaustion...\n');

  stubBackendCommand();

  const spawn = patchSpawn(() => makeFakeProc({ pid: 40000 + spawn.count, closeOnKill: false }));
  const timers = installInertTimers({ isInert: (delay) => delay === 60_000, fakeInterval: true });

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    manualRestart,
    getProcess,
    getState,
    getAutoRestartLimit,
    getLastError,
    killPython,
    STATE,
  } = require('../electron/backend-spawner.js');

  const limit = getAutoRestartLimit();

  async function crashReadyBackend() {
    const proc = getProcess();
    if (!proc) return false;
    proc.emit('close', 1, null);
    return true;
  }

  try {
    await startPythonBackend(true);
    assert(getState() === STATE.READY, 'Backend should start ready');

    for (let i = 0; i < limit; i++) {
      const crashed = await crashReadyBackend();
      assert(crashed, `Should crash backend on attempt ${i + 1}`);
      const recovered = await waitFor(() => getState() === STATE.READY, 10000);
      assert(recovered, `Backend should recover to ready after crash ${i + 1}`);
    }

    const crashedBeforeFatal = await crashReadyBackend();
    assert(crashedBeforeFatal, 'Should crash backend one final time to exhaust budget');
    const hitFatal = await waitFor(() => getState() === STATE.FATAL, 10000);
    const spawnCountAtFatal = spawn.count;

    assert(typeof limit === 'number' && limit > 0, 'Auto-restart limit should be a positive number');
    assert(hitFatal, 'Persistent crashes should eventually enter FATAL state');
    assert(getLastError()?.kind === 'fatal', 'Last error should be classified as fatal');
    assert(spawnCountAtFatal === limit + 1, `Should spawn exactly limit+1 times before FATAL (got ${spawnCountAtFatal}, limit ${limit})`);

    await flushAsyncTurns(20);
    assert(spawn.count === spawnCountAtFatal, 'No further spawns should occur after budget exhaustion');
    assert(getState() === STATE.FATAL, 'Spawner should remain fatal until manual restart');

    const recovered = await manualRestart(true, { force: true });
    assert(recovered, 'manualRestart should recover after FATAL');
    assert(getState() === STATE.READY, 'Spawner should return to ready after manualRestart');
    assert(spawn.count === spawnCountAtFatal + 1, 'manualRestart should spawn exactly one fresh backend');
  } finally {
    killPython();
    spawn.restore();
    timers.restore();
    if (timers.activeInterval) clearInterval(timers.activeInterval);
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
