const {
  assert, finish, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

const DEGRADED_READY_LINE =
  '{"jsonrpc":"2.0","method":"ready","params":{"status":"degraded","failed_handler_modules":["canvas","conversion"]}}\n';
const CLEAN_READY_LINE = '{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n';

async function run() {
  console.log('Testing backend degraded ready propagation...\n');

  stubBackendCommand();

  const spawn = patchSpawn(() => {
    const ordinal = spawn.count;
    const proc = makeFakeProc({ pid: 21000 + ordinal, ready: false, closeOnKill: false });
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from(ordinal === 1 ? DEGRADED_READY_LINE : CLEAN_READY_LINE));
    });
    return proc;
  });
  const timers = installInertTimers();

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    manualRestart,
    getReadyDegraded,
    isReady,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    const degraded = getReadyDegraded();
    assert(degraded.degraded === true, 'degraded ready handshake should be surfaced');
    assert(
      degraded.failedHandlerModules.join(',') === 'canvas,conversion',
      'failed handler modules should be surfaced',
    );

    const restarted = await manualRestart(true, { force: true });
    assert(restarted, 'manual restart should succeed');
    assert(isReady(), 'backend should be ready after manual restart');
    const clean = getReadyDegraded();
    assert(clean.degraded === false, 'clean handshake should clear the degraded flag');
    assert(clean.failedHandlerModules.length === 0, 'clean handshake should clear failed handler modules');
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
