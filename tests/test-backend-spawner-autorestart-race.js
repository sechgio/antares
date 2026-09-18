const {
  assert, finish, flushAsyncTurns, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner auto-restart vs manual restart race...\n');

  stubBackendCommand();

  let activeProcess = null;
  const spawn = patchSpawn(() => {
    const fakeProcess = makeFakeProc({ pid: 30000 + spawn.count, closeOnKill: false });
    if (spawn.count === 1) {
      setImmediate(() => fakeProcess.emit('close', 1, null));
    }
    activeProcess = fakeProcess;
    return fakeProcess;
  });
  const timers = installInertTimers({ isInert: (delay) => delay === 30_000 || delay === 60_000 || delay >= 1000 });

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    manualRestart,
    isReady,
    getProcess,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    await flushAsyncTurns(4);
    assert(spawn.count === 1, 'initial backend should spawn once');

    const manualOk = await manualRestart(true, { force: true });
    assert(manualOk, 'manual restart should succeed during auto-restart backoff');
    assert(isReady(), 'backend should be ready after manual restart');
    assert(spawn.count === 2, 'manual restart should spawn exactly one replacement backend');

    await flushAsyncTurns(8);
    assert(spawn.count === 2, 'deferred auto-restart must not spawn a third backend');
    assert(isReady(), 'backend should remain ready after deferred auto-restart settles');
    assert(getProcess() === activeProcess, 'spawner should keep the manually restarted process');
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
