const {
  assert, finish, flushAsyncTurns, stubBackendCommand, evictModule,
  makeFakeProc, patchSpawn, installInertTimers, emitBackendReady,
} = require('./helpers/harness');

async function run() {
  console.log('Testing post-handshake preempt ownership (aborted cycle vs successor)...\n');

  stubBackendCommand();

  let processA = null;
  let processB = null;
  let releaseB = null;

  const spawn = patchSpawn(() => {
    const fakeProcess = makeFakeProc({ pid: 40000 + spawn.count, ready: false, closeOnKill: false });

    if (spawn.count === 1) {
      processA = fakeProcess;
    } else if (spawn.count === 2) {
      processB = fakeProcess;
      releaseB = () => emitBackendReady(fakeProcess);
    } else {
      process.nextTick(() => emitBackendReady(fakeProcess));
    }

    return fakeProcess;
  });
  const timers = installInertTimers({ isInert: (delay) => delay === 30_000 || delay === 60_000 || delay >= 1000 });

  evictModule('electron/backend-spawner.js');
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
    assert(spawn.count === 1, 'cycle A should spawn once and wait for handshake');
    assert(getState() === 'starting', 'cycle A should be in starting while handshake is held');
    assert(processA && !processA.killed, 'cycle A process should still be alive before preempt');

    let manualSettled = false;
    let manualResult = null;
    const manualPromise = manualRestart(true, { force: true }).then((ok) => {
      manualSettled = true;
      manualResult = ok;
      return ok;
    });

    await flushAsyncTurns(8);
    assert(spawn.count === 2, 'manual restart should spawn successor cycle B');
    assert(processB != null, 'cycle B process should exist');
    assert(getProcess() === processB, 'pythonProcess should belong to cycle B');
    assert(getState() === 'starting', 'cycle B should still be in handshake');
    assert(!manualSettled, 'manualRestart should still be awaiting cycle B handshake');

    emitBackendReady(processA);
    await cycleA;
    await flushAsyncTurns(8);

    assert(!processB.killed, 'aborted cycle A must NOT kill cycle B process');
    assert(getProcess() === processB, 'pythonProcess must still reference cycle B after A resumes');
    assert(getState() === 'starting', 'cycle B start slot must remain in progress (A must not clear it)');
    assert(!manualSettled, 'manualRestart must still own the in-flight start after A settles');

    releaseB();
    await manualPromise;
    await flushAsyncTurns(4);

    assert(manualResult === true, 'manual restart should complete successfully after B handshake');
    assert(isReady(), 'backend should be ready with cycle B');
    assert(getProcess() === processB, 'ready process should still be cycle B');
    assert(!processB.killed, 'cycle B process must remain alive after full settle');
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
