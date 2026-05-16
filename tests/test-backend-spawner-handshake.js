// Regression test: a successful handshake must cancel its timeout.
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
  console.log('Testing backend spawner handshake cleanup...\n');

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
  let handshakeTimer = null;
  let clearedHandshakeTimer = null;
  let fakeProcess = null;

  childProcess.spawn = () => {
    fakeProcess = new EventEmitter();
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.stdin = new EventEmitter();
    fakeProcess.stdin.end = () => {};
    fakeProcess.killed = false;
    fakeProcess.pid = 12345;
    fakeProcess.kill = () => {
      fakeProcess.killed = true;
    };
    process.nextTick(() => {
      fakeProcess.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'));
    });
    return fakeProcess;
  };

  global.setTimeout = (fn, delay, ...args) => {
    if (delay === 30_000) {
      handshakeTimer = { fn, delay };
      return handshakeTimer;
    }
    return originalSetTimeout(fn, delay, ...args);
  };
  global.clearTimeout = (timer) => {
    if (timer === handshakeTimer) {
      clearedHandshakeTimer = timer;
      return undefined;
    }
    return originalClearTimeout(timer);
  };

  const backendSpawnerPath = require.resolve('../electron/backend-spawner.js');
  delete require.cache[backendSpawnerPath];
  const { startPythonBackend, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);
    assert(handshakeTimer !== null, 'Spawner should create a handshake timer');
    assert(clearedHandshakeTimer === handshakeTimer, 'Successful handshake should clear its timeout');
  } finally {
    if (fakeProcess) fakeProcess.killed = true;
    killPython();
    childProcess.spawn = originalSpawn;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
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
