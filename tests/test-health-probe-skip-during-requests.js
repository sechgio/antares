const {
  assert, finish, flushAsyncTurns, waitFor, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers,
} = require('./helpers/harness');

async function run() {
  console.log('Testing health probe skips restart when requests are in flight...\n');

  stubBackendCommand();

  const spawn = patchSpawn(() => makeFakeProc({ pid: 20000 + spawn.count }));
  const timers = installInertTimers();

  evictModule('electron/backend-spawner.js');
  const {
    startPythonBackend,
    runHealthCheckOnce,
    getHealthStatus,
    getState,
    killPython,
    incrementPendingRequests,
    decrementPendingRequests,
    getPendingRequestCount,
    noteJobActivity,
    clearJobActivity,
    hasRecentJobActivity,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(getState() === 'ready', 'Backend should be ready');
    assert(getPendingRequestCount() === 0, 'No pending requests initially');

    incrementPendingRequests();
    assert(getPendingRequestCount() === 1, 'Pending count should be 1 after increment');

    await runHealthCheckOnce();
    await flushAsyncTurns(5);

    assert(getState() === 'ready', 'Backend should still be ready (no restart triggered)');
    assert(spawn.count === 1, 'Should NOT have spawned a new process (spawnCount still 1)');
    assert(getHealthStatus().last_skip_reason === 'requests_in_flight', 'Health status records request-based probe skip');

    decrementPendingRequests();
    assert(getPendingRequestCount() === 0, 'Pending count should be 0 after decrement');

    noteJobActivity();
    assert(hasRecentJobActivity(), 'Job activity should be marked recent (progress or heartbeat)');
    await runHealthCheckOnce();
    await flushAsyncTurns(5);
    assert(getState() === 'ready', 'Backend should stay ready during recent job activity');
    assert(spawn.count === 1, 'Should NOT restart while job activity is recent');
    assert(getHealthStatus().last_skip_reason === 'job_active', 'Health status records job-based probe skip');

    noteJobActivity();
    assert(hasRecentJobActivity(), 'Repeated heartbeat/progress still marks activity recent');
    await runHealthCheckOnce();
    await flushAsyncTurns(5);
    assert(getState() === 'ready', 'Backend should stay ready after repeated job activity');
    assert(spawn.count === 1, 'Should NOT restart after repeated noteJobActivity');

    clearJobActivity();
    assert(!hasRecentJobActivity(), 'Job activity cleared');

    await runHealthCheckOnce();
    const restarted = await waitFor(() => spawn.count >= 2 && getState() === 'ready');
    assert(restarted, 'Backend SHOULD restart when no requests are in flight and no job activity');

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
