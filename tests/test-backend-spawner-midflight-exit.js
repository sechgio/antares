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
  console.log('Testing backend spawner mid-flight exit...\n');

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
  let fakeProcess = null;

  childProcess.spawn = () => {
    fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.write = () => true;
    fakeProcess.stdin.end = () => {};
    fakeProcess.killed = false;
    fakeProcess.pid = 61001;
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

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const { startPythonBackend, isReady, getState, STATE, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(isReady(), 'backend should be ready after handshake');
    assert(getState() === STATE.READY, 'spawner state should be ready');

    fakeProcess.emit('close', 1);

    const becameUnavailable = await waitFor(() => !isReady());
    assert(becameUnavailable, 'readiness should clear after backend exit');
    assert(
      getState() === STATE.EXITED || getState() === STATE.STARTING,
      'spawner should reflect exit or auto-restart after crash',
    );
  } finally {
    childProcess.spawn = originalSpawn;
    killPython();
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
