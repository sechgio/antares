// Regression test: a backend that remains alive but stops responding should be
// treated as unhealthy and restarted by the supervisor.
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
  console.log('Testing backend spawner health recovery...\n');

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
      setImmediate(() => fakeProcess.emit('close', 1, null));
    };

    process.nextTick(() => {
      fakeProcess.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","method":"ready","params":{"status":"ok"}}\n'));
    });

    childProcess.spawn.lastProc = fakeProcess;
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
  const { startPythonBackend, runHealthCheckOnce, getState, killPython } = require('../electron/backend-spawner.js');

  try {
    await startPythonBackend(true);

    // Test 1: Responsive backend handling large concurrent stdout traffic during probe
    const activeProc = childProcess.spawn.lastProc;
    if (activeProc) {
      activeProc.stdin.write = (chunk) => {
        try {
          const msg = JSON.parse(chunk.toString().trim());
          if (msg.id && String(msg.id).startsWith('health-')) {
            // Emit large unrelated RPC response first
            const hugePayload = JSON.stringify({
              jsonrpc: '2.0',
              id: 'large-canvas-123',
              result: { layers: new Array(100).fill({ type: 'shape', data: 'x'.repeat(2000) }) },
            });
            activeProc.stdout.emit('data', Buffer.from(hugePayload + '\n'));
            // Then emit matching health probe response
            const probeResponse = JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { version: '0.11.9' },
            });
            activeProc.stdout.emit('data', Buffer.from(probeResponse + '\n'));
          }
        } catch { /* ignore */ }
      };
    }
    await runHealthCheckOnce();
    assert(spawnCount === 1, 'Responsive backend should not restart when handling concurrent traffic');
    assert(getState() === 'ready', 'Backend should remain in ready state');

    // Test 2: Unresponsive backend (stdin.write does nothing) triggers restart
    if (activeProc) {
      activeProc.stdin.write = () => {};
    }
    await runHealthCheckOnce();
    const restarted = await waitFor(() => spawnCount >= 2 && getState() === 'ready');

    assert(restarted, 'Unresponsive backend should be restarted automatically');
    assert(getState() === 'ready', 'Spawner should return to ready after health recovery');
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
