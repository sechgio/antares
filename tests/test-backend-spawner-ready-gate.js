// Regression test: a waitForReady() caller that arrives DURING an auto-restart
// backoff window must resolve once the replacement backend is ready.
//
// Before the fix, _autoRestart() created a fresh readiness gate and then
// startPythonBackend() created ANOTHER one after the backoff, orphaning the
// first. Waiters attached to the orphaned gate hung until their own timeout
// and failed with "backend unavailable" even though the backend recovered.
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

async function waitFor(predicate, maxTurns = 5000) {
  for (let i = 0; i < maxTurns; i++) {
    if (predicate()) return true;
    await flushAsyncTurns();
  }
  return false;
}

// Delays that must NOT fire on their own: the auto-restart backoff (1000ms,
// fired manually by the test) and long-lived timers (handshake/reset/waiter).
const INERT_DELAYS = new Set([1_000, 5_000, 30_000, 60_000]);

async function run() {
  console.log('Testing readiness gate across auto-restart backoff...\n');

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
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'));
      if (spawnCount === 1) {
        // First backend crashes right after becoming ready (transient).
        setImmediate(() => fakeProcess.emit('close', 1, null));
      }
    });

    return fakeProcess;
  };
  global.setTimeout = (fn, delay, ...args) => {
    if (INERT_DELAYS.has(delay)) {
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
    waitForReady,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(getState() === 'ready', 'Initial backend should be ready');

    // Wait until the crash triggers the auto-restart backoff: state flips to
    // 'starting' and the 1000ms backoff timer is captured (not yet fired).
    const inBackoff = await waitFor(
      () => getState() === 'starting' && [...inertTimers].some((t) => t.delay === 1_000),
    );
    assert(inBackoff, 'Crash should trigger auto-restart backoff (state=starting, backoff pending)');
    assert(spawnCount === 1, 'No replacement spawn should happen before the backoff elapses');

    // A renderer request arriving now blocks in waitForReady(). Its 5s timeout
    // is inert in this test, so ONLY the readiness gate can settle it.
    let waiterResult = null;
    waitForReady(5_000).then((result) => { waiterResult = result; });
    await flushAsyncTurns(5);
    assert(waiterResult === null, 'waitForReady should stay pending during the backoff window');

    // Let the backoff elapse -> startPythonBackend spawns the replacement.
    const backoffTimer = [...inertTimers].find((t) => t.delay === 1_000);
    inertTimers.delete(backoffTimer);
    backoffTimer.fn(...backoffTimer.args);

    const waiterSettled = await waitFor(() => waiterResult !== null);
    assert(waiterSettled, 'waitForReady registered during backoff must settle after respawn (gate not orphaned)');
    assert(waiterResult === true, 'waitForReady should resolve true once the replacement backend is ready');
    assert(spawnCount === 2, 'Exactly one replacement backend should spawn');
    assert(getState() === 'ready', 'Spawner should be ready after the auto-restart');
  } finally {
    killPython();
    childProcess.spawn = originalSpawn;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    if (activeInterval) clearInterval(activeInterval);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
