const {
  assert, finish, stubBackendCommand, evictModule, makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing backend spawner handshake cleanup...\n');

  stubBackendCommand();

  let handshakeTimer = null;
  let clearedHandshakeTimer = null;
  let fakeProcess = null;

  const spawn = patchSpawn(() => {
    fakeProcess = makeFakeProc({ closeOnKill: false });
    return fakeProcess;
  });
  const timers = installInertTimers({
    fastForward: false,
    onInert: (timer) => { if (!handshakeTimer) handshakeTimer = timer; },
    onClear: (timer) => { if (timer === handshakeTimer) clearedHandshakeTimer = timer; },
  });

  evictModule('electron/backend-spawner.js');
  const { startPythonBackend, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(handshakeTimer !== null, 'Spawner should create a handshake timer');
    assert(clearedHandshakeTimer === handshakeTimer, 'Successful handshake should clear its timeout');
  } finally {
    if (fakeProcess) fakeProcess.killed = true;
    killPython();
    spawn.restore();
    timers.restore();
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
