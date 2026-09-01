// Regression: automatic recovery after an unresponsive backend must honor the
// same exponential backoff as unexpected child exits.
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

async function run() {
  console.log('Testing backend health recovery backoff...\n');

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
  const timers = [];

  childProcess.spawn = () => {
    spawnCount++;
    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.end = () => {};
    fakeProcess.stdin.write = () => true;
    fakeProcess.killed = false;
    fakeProcess.pid = 32000 + spawnCount;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit(
        'data',
        Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'),
      );
    });

    childProcess.spawn.lastProc = fakeProcess;
    return fakeProcess;
  };

  global.setTimeout = (fn, delay, ...args) => {
    const timer = { fn, delay, args, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer && typeof timer === 'object') timer.cleared = true;
    else originalClearTimeout(timer);
  };
  global.setInterval = (fn, delay, ...args) => {
    activeInterval = { fn, delay, args };
    return activeInterval;
  };
  global.clearInterval = (timer) => {
    if (timer === activeInterval) activeInterval = null;
    else originalClearInterval(timer);
  };

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const {
    startPythonBackend,
    runHealthCheckOnce,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    const expectedBackoffs = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
    for (let index = 0; index < expectedBackoffs.length; index++) {
      const activeProc = childProcess.spawn.lastProc;
      activeProc.stdin.write = () => true;

      const recovery = runHealthCheckOnce();
      await flushAsyncTurns(3);
      const probeTimer = timers.find((timer) => timer.delay === 3_000 && !timer.cleared);
      assert(Boolean(probeTimer), `health check ${index + 1} should arm its probe timeout`);
      probeTimer.fn(...probeTimer.args);
      await flushAsyncTurns(3);

      const expectedSpawnCount = index + 1;
      assert(
        spawnCount === expectedSpawnCount,
        `health recovery ${index + 1} must not spawn before recovery backoff`,
      );
      const backoffTimer = timers.find(
        (timer) => timer.delay === expectedBackoffs[index] && !timer.cleared,
      );
      assert(
        Boolean(backoffTimer),
        `health recovery ${index + 1} should use ${expectedBackoffs[index]}ms backoff`,
      );
      assert(getState() === 'starting', `spawner should remain starting during recovery ${index + 1} backoff`);

      backoffTimer.fn(...backoffTimer.args);
      await recovery;
      assert(spawnCount === expectedSpawnCount + 1, `health recovery ${index + 1} should spawn one replacement`);
      assert(getState() === 'ready', `spawner should return to ready after recovery ${index + 1}`);
    }
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
