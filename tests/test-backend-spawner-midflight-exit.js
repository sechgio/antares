const {
  assert, finish, waitFor, stubBackendCommand, evictModule, makeFakeProc, patchSpawn,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner mid-flight exit...\n');

  stubBackendCommand();

  let fakeProcess = null;
  const spawn = patchSpawn(() => {
    fakeProcess = makeFakeProc({ pid: 61001, closeOnKill: false });
    return fakeProcess;
  });

  evictModule('electron/backend-spawner.js');
  const { startPythonBackend, isReady, getState, STATE, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(isReady(), 'backend should be ready after handshake');
    assert(getState() === STATE.READY, 'spawner state should be ready');

    fakeProcess.emit('close', 1);

    const becameUnavailable = await waitFor(() => !isReady());
    assert(becameUnavailable, 'readiness should clear after backend exit');
    assert(
      getState() === STATE.EXITED || getState() === STATE.STARTING,
      'spawner should reflect exit or auto-restart after crash',
    );
  } finally {
    spawn.restore();
    killPython();
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
