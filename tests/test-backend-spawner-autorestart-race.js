// Regression test: manualRestart during _autoRestart backoff must not leave a
// second Python process when the deferred auto-restart cycle resumes.
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
  console.log('Testing backend spawner auto-restart vs manual restart race...\n');

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
  let activeProcess = null;
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
    fakeProcess.pid = 30000 + spawnCount;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit(
        'data',
        Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'),
      );
      if (spawnCount === 1) {
        setImmediate(() => fakeProcess.emit('close', 1, null));
      }
    });

    activeProcess = fakeProcess;
    return fakeProcess;
  };

  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 30_000 || delay === 60_000 || delay >= 1000) {
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
    getProcess,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    await flushAsyncTurns(4);
    assert(spawnCount === 1, 'initial backend should spawn once');

    const manualOk = await manualRestart(true, { force: true });
    assert(manualOk, 'manual restart should succeed during auto-restart backoff');
    assert(isReady(), 'backend should be ready after manual restart');
    assert(spawnCount === 2, 'manual restart should spawn exactly one replacement backend');

    await flushAsyncTurns(8);
    assert(spawnCount === 2, 'deferred auto-restart must not spawn a third backend');
    assert(isReady(), 'backend should remain ready after deferred auto-restart settles');
    assert(getProcess() === activeProcess, 'spawner should keep the manually restarted process');
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
