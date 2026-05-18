// Regression test: killing the backend during app shutdown must not block the
// main process on Windows while taskkill runs.
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

async function run() {
  console.log('Testing backend spawner shutdown path...\n');

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
  const originalExecFileSync = childProcess.execFileSync;
  const originalExecFile = childProcess.execFile;
  const originalPlatform = process.platform;
  let syncTaskkillCalls = 0;
  let asyncTaskkillCalls = 0;

  Object.defineProperty(process, 'platform', { value: 'win32' });

  childProcess.spawn = () => {
    const fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.end = () => {};
    fakeProcess.killed = false;
    fakeProcess.pid = 54321;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };
    process.nextTick(() => {
      fakeProcess.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'));
    });
    return fakeProcess;
  };

  childProcess.execFileSync = () => {
    syncTaskkillCalls++;
  };
  childProcess.execFile = (_cmd, _args, _opts, callback) => {
    asyncTaskkillCalls++;
    callback?.(null);
    return new EventEmitter();
  };

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const { startPythonBackend, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    killPython();

    assert(syncTaskkillCalls === 0, 'Shutdown should not use blocking taskkill');
    assert(asyncTaskkillCalls === 1, 'Shutdown should schedule taskkill asynchronously on Windows');
  } finally {
    childProcess.spawn = originalSpawn;
    childProcess.execFileSync = originalExecFileSync;
    childProcess.execFile = originalExecFile;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
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
