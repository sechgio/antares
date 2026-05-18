// Regression test: health probe must NOT restart the backend when there are
// in-flight IPC requests. A timeout during active work is a false positive —
// the backend is busy, not dead.
const { EventEmitter } = require('events');
const childProcess = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function flushAsyncTurns(turns = 1) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(predicate, maxTurns = 500) {
  for (let i = 0; i < maxTurns; i++) {
    if (predicate()) return true;
    await flushAsyncTurns();
  }
  return false;
}

async function run() {
  console.log('Testing health probe skips restart when requests are in flight...\n');

  const backendCommandPath = require.resolve('../electron/backend-command.js');
  require.cache[backendCommandPath] = {
    id: backendCommandPath,
    filename: backendCommandPath,
    loaded: true,
    exports: {
      getBackendCommand: () => ({ cmd: 'python', args: [] }),
    },
  };

  const originalSpawn = childProcess.spawn;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let spawnCount = 0;
  let activeInterval = null;
  const inertTimers = new Set();

  childProcess.spawn = () => {
    spawnCount++;
    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.end = () => {};
    fakeProcess.stdin.write = () => {};
    fakeProcess.killed = false;
    fakeProcess.pid = 20000 + spawnCount;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
      setImmediate(() => fakeProcess.emit('close', 1, null));
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'));
    });

    return fakeProcess;
  };

  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 30_000 || delay === 60_000) {
      const timer = { fn, delay, args };
      inertTimers.add(timer);
      return timer;
    }
    return originalSetTimeout(fn, 0, ...args);
  };
  global.clearTimeout = (timer) => {
    if (inertTimers.has(timer)) {
      inertTimers.delete(timer);
      return undefined;
    }
    return originalClearTimeout(timer);
  };
  global.setInterval = (fn, delay, ...args) => {
    activeInterval = originalSetInterval(fn, delay, ...args);
    return activeInterval;
  };
  global.clearInterval = (timer) => {
    if (timer === activeInterval) activeInterval = null;
    return originalClearInterval(timer);
  };

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const {
    startPythonBackend,
    runHealthCheckOnce,
    getState,
    killPython,
    incrementPendingRequests,
    decrementPendingRequests,
    getPendingRequestCount,
  } = require('../electron/backend-spawner.js');

  try {
    // Start the backend
    await startPythonBackend(true);
    assert(getState() === 'ready', 'Backend should be ready');
    assert(getPendingRequestCount() === 0, 'No pending requests initially');

    // Simulate an in-flight request
    incrementPendingRequests();
    assert(getPendingRequestCount() === 1, 'Pending count should be 1 after increment');

    // Run health check — it will timeout (fake process doesn't respond to probes)
    // but should NOT restart because there's a pending request
    await runHealthCheckOnce();
    await flushAsyncTurns(5);

    assert(getState() === 'ready', 'Backend should still be ready (no restart triggered)');
    assert(spawnCount === 1, 'Should NOT have spawned a new process (spawnCount still 1)');

    // Clean up the pending request
    decrementPendingRequests();
    assert(getPendingRequestCount() === 0, 'Pending count should be 0 after decrement');

    // Now run health check again with NO pending requests — this time it SHOULD restart
    await runHealthCheckOnce();
    const restarted = await waitFor(() => spawnCount >= 2 && getState() === 'ready');
    assert(restarted, 'Backend SHOULD restart when no requests are in flight');

  } finally {
    killPython();
    childProcess.spawn = originalSpawn;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    if (activeInterval) clearInterval(activeInterval);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
