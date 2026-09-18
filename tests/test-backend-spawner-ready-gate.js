const {
  assert, finish, flushAsyncTurns, waitFor, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

const INERT_DELAYS = new Set([1_000, 5_000, 30_000, 60_000]);

async function run() {
  console.log('Testing readiness gate across auto-restart backoff...\n');

  stubBackendCommand();

  const spawn = patchSpawn(() => {
    const proc = makeFakeProc({ pid: 20000 + spawn.count, closeOnKill: false });
    if (spawn.count === 1) setImmediate(() => proc.emit('close', 1, null));
    return proc;
  });
  const timers = installInertTimers({ isInert: (delay) => INERT_DELAYS.has(delay) });
  const { inertTimers } = timers;

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    waitForReady,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(getState() === 'ready', 'Initial backend should be ready');

    const inBackoff = await waitFor(
      () => getState() === 'starting' && [...inertTimers].some((t) => t.delay === 1_000),
    );
    assert(inBackoff, 'Crash should trigger auto-restart backoff (state=starting, backoff pending)');
    assert(spawn.count === 1, 'No replacement spawn should happen before the backoff elapses');

    let waiterResult = null;
    waitForReady(5_000).then((result) => { waiterResult = result; });
    await flushAsyncTurns(5);
    assert(waiterResult === null, 'waitForReady should stay pending during the backoff window');

    const backoffTimer = [...inertTimers].find((t) => t.delay === 1_000);
    inertTimers.delete(backoffTimer);
    backoffTimer.fn(...backoffTimer.args);

    const waiterSettled = await waitFor(() => waiterResult !== null);
    assert(waiterSettled, 'waitForReady registered during backoff must settle after respawn (gate not orphaned)');
    assert(waiterResult === true, 'waitForReady should resolve true once the replacement backend is ready');
    assert(spawn.count === 2, 'Exactly one replacement backend should spawn');
    assert(getState() === 'ready', 'Spawner should be ready after the auto-restart');
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
