// Regression test: manualRestart must preempt a stuck start cycle instead of
// leaving the start cycle latched and blocking all future restarts.
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
  console.log('Testing backend spawner manual restart preemption...\n');

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
  let failHandshakeCount = 0;
  let activeInterval = null;
  const inertTimers = new Set();

  childProcess.spawn = () => {
    spawnCount++;
    const failThisSpawn = failHandshakeCount > 0;
    if (failThisSpawn) failHandshakeCount--;

    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.end = () => {};
    fakeProcess.killed = false;
    fakeProcess.pid = 20000 + spawnCount;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };

    process.nextTick(() => {
      if (failThisSpawn) {
        setImmediate(() => fakeProcess.emit('close', 1, null));
        return;
      }
      fakeProcess.stdout.emit(
        'data',
        Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'),
      );
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
    manualRestart,
    isReady,
    getState,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    failHandshakeCount = 99;
    const stuckStart = startPythonBackend(true);
    await flushAsyncTurns(2);
    assert(getState() === 'starting', 'transient failure should leave spawner in starting state');

    failHandshakeCount = 0;
    const firstManual = await manualRestart(true, { force: true });
    assert(firstManual, 'manual restart should succeed while an auto-retry cycle is in flight');
    assert(isReady(), 'manual restart should reach ready state');

    failHandshakeCount = 1;
    const secondManual = await manualRestart(true, { force: true });
    assert(secondManual, 'a second manual restart should not be blocked by a stale start flag');
    assert(isReady(), 'second manual restart should recover to ready');

    await stuckStart;
    const thirdManual = await manualRestart(true, { force: true });
    assert(thirdManual, 'manual restart should remain available after the preempted cycle settles');
    assert(isReady(), 'backend should still be ready after preempted cycle settles');
    assert(spawnCount >= 3, 'manual restart should spawn fresh backend processes');
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