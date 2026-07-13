// Regression test: persistent crashes must exhaust the auto-restart budget and
// enter FATAL; manualRestart must clear FATAL and allow a fresh start.
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

async function run() {
  console.log('Testing backend spawner restart budget exhaustion...\n');

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
    fakeProcess.stdin.write = () => true;
    fakeProcess.killed = false;
    fakeProcess.pid = 40000 + spawnCount;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit(
        'data',
        Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'),
      );
    });

    return fakeProcess;
  };

  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 60_000) {
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
    activeInterval = { fn, delay, args };
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
    manualRestart,
    getProcess,
    getState,
    getAutoRestartLimit,
    getLastError,
    killPython,
    STATE,
  } = require('../electron/backend-spawner.js');

  const limit = getAutoRestartLimit();

  async function crashReadyBackend() {
    const proc = getProcess();
    if (!proc) return false;
    proc.emit('close', 1, null);
    return true;
  }

  try {
    await startPythonBackend(true);
    assert(getState() === STATE.READY, 'Backend should start ready');

    for (let i = 0; i < limit; i++) {
      const crashed = await crashReadyBackend();
      assert(crashed, `Should crash backend on attempt ${i + 1}`);
      const recovered = await waitFor(() => getState() === STATE.READY, 10000);
      assert(recovered, `Backend should recover to ready after crash ${i + 1}`);
    }

    const crashedBeforeFatal = await crashReadyBackend();
    assert(crashedBeforeFatal, 'Should crash backend one final time to exhaust budget');
    const hitFatal = await waitFor(() => getState() === STATE.FATAL, 10000);
    const spawnCountAtFatal = spawnCount;

    assert(typeof limit === 'number' && limit > 0, 'Auto-restart limit should be a positive number');
    assert(hitFatal, 'Persistent crashes should eventually enter FATAL state');
    assert(getLastError()?.kind === 'fatal', 'Last error should be classified as fatal');
    assert(spawnCountAtFatal === limit + 1, `Should spawn exactly limit+1 times before FATAL (got ${spawnCountAtFatal}, limit ${limit})`);

    await flushAsyncTurns(20);
    assert(spawnCount === spawnCountAtFatal, 'No further spawns should occur after budget exhaustion');
    assert(getState() === STATE.FATAL, 'Spawner should remain fatal until manual restart');

    const recovered = await manualRestart(true, { force: true });
    assert(recovered, 'manualRestart should recover after FATAL');
    assert(getState() === STATE.READY, 'Spawner should return to ready after manualRestart');
    assert(spawnCount === spawnCountAtFatal + 1, 'manualRestart should spawn exactly one fresh backend');
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
