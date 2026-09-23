const {
  assert, finish, waitFor, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner transient recovery...\n');

  stubBackendCommand();

  const spawn = patchSpawn(() => {
    const proc = makeFakeProc({ pid: 10000 + spawn.count, closeOnKill: false });
    if (spawn.count === 1) setImmediate(() => proc.emit('close', 1, null));
    return proc;
  });
  const timers = installInertTimers();

  evictModule('electron/backend-spawner.js');
  const { startPythonBackend, getState, getAutoRestartLimit, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    await new Promise((resolve) => timers.original.setTimeout(resolve, 300));
    const recoveredAfterCrash = await waitFor(() => spawn.count >= 2 && getState() === 'ready');

    assert(typeof getAutoRestartLimit() === 'number' && getAutoRestartLimit() > 0, 'Auto-restart budget should be a positive finite limit');
    assert(recoveredAfterCrash, 'Transient crashes should trigger a fresh backend spawn');
    assert(getState() === 'ready', 'Spawner should recover to ready after a transient crash');
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
