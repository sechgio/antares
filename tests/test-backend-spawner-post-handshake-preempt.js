// Regression: after a preempt, an aborted start cycle whose handshake resolves
// late must NOT kill the successor's process or clear the successor's start slot.
//
// Race window:
//   1. Cycle A spawns and waits for ready.
//   2. manualRestart preempts A, kills A (mock does not emit close), starts B.
//   3. Cycle B spawns and is still in handshake (held).
//   4. Cycle A's stdout finally emits ready → A's await _spawn resolves.
//   5. A sees cycleSignal.aborted. Without ownership checks it would
//      _forceKillProcess(pythonProcess) (B!) and _clearStartCycle() (B's slot!).
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

function emitReady(proc) {
  proc.stdout.emit(
    'data',
    Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'),
  );
}

async function run() {
  console.log('Testing post-handshake preempt ownership (aborted cycle vs successor)...\n');

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
  let processA = null;
  let processB = null;
  let releaseB = null;
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
    // Deliberately do NOT emit 'close' on kill — mirrors the window where
    // A's handshake can still resolve after the global pythonProcess moved to B.
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };

    if (spawnCount === 1) {
      processA = fakeProcess;
      // Hold A's ready until the test releases it after B owns pythonProcess.
    } else if (spawnCount === 2) {
      processB = fakeProcess;
      // Hold B's ready so B still owns `_currentStart` when A resumes.
      releaseB = () => emitReady(fakeProcess);
    } else {
      process.nextTick(() => emitReady(fakeProcess));
    }

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
    getState,
    getProcess,
    killPython,
  } = require('../electron/backend-spawner.js');

  try {
    const cycleA = startPythonBackend(true);
    await flushAsyncTurns(4);
    assert(spawnCount === 1, 'cycle A should spawn once and wait for handshake');
    assert(getState() === 'starting', 'cycle A should be in starting while handshake is held');
    assert(processA && !processA.killed, 'cycle A process should still be alive before preempt');

    // Start manual restart but do not await it yet — it will claim cycle B and
    // hang in B's handshake (held by the mock).
    let manualSettled = false;
    let manualResult = null;
    const manualPromise = manualRestart(true, { force: true }).then((ok) => {
      manualSettled = true;
      manualResult = ok;
      return ok;
    });

    await flushAsyncTurns(8);
    assert(spawnCount === 2, 'manual restart should spawn successor cycle B');
    assert(processB != null, 'cycle B process should exist');
    assert(getProcess() === processB, 'pythonProcess should belong to cycle B');
    assert(getState() === 'starting', 'cycle B should still be in handshake');
    assert(!manualSettled, 'manualRestart should still be awaiting cycle B handshake');

    // Late handshake for the preempted cycle A — this is the dangerous resume.
    emitReady(processA);
    await cycleA;
    await flushAsyncTurns(8);

    assert(!processB.killed, 'aborted cycle A must NOT kill cycle B process');
    assert(getProcess() === processB, 'pythonProcess must still reference cycle B after A resumes');
    assert(getState() === 'starting', 'cycle B start slot must remain in progress (A must not clear it)');
    assert(!manualSettled, 'manualRestart must still own the in-flight start after A settles');

    // Let cycle B finish; ownership checks should have left its slot intact.
    releaseB();
    await manualPromise;
    await flushAsyncTurns(4);

    assert(manualResult === true, 'manual restart should complete successfully after B handshake');
    assert(isReady(), 'backend should be ready with cycle B');
    assert(getProcess() === processB, 'ready process should still be cycle B');
    assert(!processB.killed, 'cycle B process must remain alive after full settle');
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
