const {
  assert, finish, flushAsyncTurns, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers, emitBackendReady,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner manual restart preemption...\n');

  stubBackendCommand();

  let failHandshakeCount = 0;
  const spawn = patchSpawn(() => {
    const failThisSpawn = failHandshakeCount > 0;
    if (failThisSpawn) failHandshakeCount--;

    const fakeProcess = makeFakeProc({ pid: 20000 + spawn.count, ready: false, closeOnKill: false });

    process.nextTick(() => {
      if (failThisSpawn) {
        setImmediate(() => fakeProcess.emit('close', 1, null));
        return;
      }
      emitBackendReady(fakeProcess);
    });

    return fakeProcess;
  });
  const timers = installInertTimers();

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    manualRestart,
    isReady,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    failHandshakeCount = 99;
    const stuckStart = startPythonBackend(true);
    await flushAsyncTurns(2);
    assert(getState() === 'starting', 'transient failure should leave spawner in starting state');

    failHandshakeCount = 0;
    const firstManual = await manualRestart(true, { force: true });
    assert(firstManual, 'manual restart should succeed while an auto-retry cycle is in flight');
    assert(isReady(), 'manual restart should reach ready state');

    failHandshakeCount = 1;
    const secondManual = await manualRestart(true, { force: true });
    assert(secondManual, 'a second manual restart should not be blocked by a stale start flag');
    assert(isReady(), 'second manual restart should recover to ready');

    await stuckStart;
    const thirdManual = await manualRestart(true, { force: true });
    assert(thirdManual, 'manual restart should remain available after the preempted cycle settles');
    assert(isReady(), 'backend should still be ready after preempted cycle settles');
    assert(spawn.count >= 3, 'manual restart should spawn fresh backend processes');
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
