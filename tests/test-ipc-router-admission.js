const { EventEmitter } = require('events');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${message}`);
    failed += 1;
  }
}

function makeProc(pid) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.killed = false;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdin.write = () => true;
  return proc;
}

function loadRouter({ currentProc, incrementPendingRequests, decrementPendingRequests, env = {} }) {
  const oldEnv = new Map(Object.entries(env).map(([key]) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: { handle: () => {}, removeHandler: () => {} },
      dialog: {},
      app: { isPackaged: true },
    },
  };

  const spawnerPath = require.resolve('../electron/backend-spawner');
  require.cache[spawnerPath] = {
    id: spawnerPath,
    filename: spawnerPath,
    loaded: true,
    exports: {
      getProcess: () => currentProc.ref,
      isReady: () => true,
      waitForReady: async () => true,
      getState: () => 'ready',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests,
      decrementPendingRequests,
      noteJobActivity: () => {},
      clearJobActivity: () => {},
      STATE: { READY: 'ready', FATAL: 'fatal', STARTING: 'starting', EXITED: 'exited' },
    },
  };

  const wmPath = require.resolve('../electron/window-manager');
  require.cache[wmPath] = {
    id: wmPath,
    filename: wmPath,
    loaded: true,
    exports: {
      getMainWindow: () => null,
      buildAppMenu: () => ({ popup: () => {} }),
      getIsDev: () => true,
    },
  };

  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  const router = require(routerPath);

  for (const [key, value] of oldEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return router;
}

function respond(proc, write, result = { ok: true }) {
  const request = JSON.parse(String(write).trim());
  proc.stdout.emit(
    'data',
    Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n'),
  );
}

async function getRejection(request) {
  const settled = await Promise.race([
    request.then(
      () => ({ error: null }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => setImmediate(() => resolve(null))),
  ]);
  return settled?.error || null;
}

async function run() {
  console.log('Testing IPC pending-request admission...\n');

  {
    const currentProc = { ref: makeProc(1001) };
    const writes = [];
    let increments = 0;
    let decrements = 0;
    currentProc.ref.stdin.write = (line) => {
      writes.push(line);
      return true;
    };
    const router = loadRouter({
      currentProc,
      incrementPendingRequests: () => { increments += 1; },
      decrementPendingRequests: () => { decrements += 1; },
      env: {
        ANTARES_IPC_MAX_PENDING_REQUESTS: '10',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '1',
      },
    });

    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (line) => warnings.push(line);
    try {
      const first = router._sendRequest('version', {});
      const rejectedRequest = router._sendRequest('version', {});
      const rejection = await getRejection(rejectedRequest);

      assert(rejection instanceof Error, 'per-method admission rejection is an Error');
      assert(rejection?.code === -32005, 'per-method rejection has JSON-RPC capacity code');
      assert(rejection?.category === 'CAPACITY_EXCEEDED', 'per-method rejection has capacity category');
      assert(rejection?.details?.retryable === true, 'per-method rejection is retryable');
      assert(rejection?.details?.reason === 'ipc_method_pending_limit', 'per-method rejection reports its reason');
      assert(rejection?.details?.pending === 1 && rejection?.details?.limit === 1, 'per-method rejection includes pending count and limit');
      assert(writes.length === 1, 'per-method rejection does not write to stdin');
      assert(increments === 1 && decrements === 0, 'per-method rejection does not mutate spawner pending count');
      assert(warnings.some((line) => line.includes('outcome=rejected')), 'per-method rejection emits rejected IPC telemetry');

      respond(currentProc.ref, writes[0]);
      if (!rejection) respond(currentProc.ref, writes[1]);
      await first;
      const second = router._sendRequest('version', {});
      assert(writes.length === 2, 'response releases per-method capacity for a later request');
      respond(currentProc.ref, writes[writes.length - 1]);
      await second;
      assert(increments === 2 && decrements === 2, 'response releases each accepted request once');
    } finally {
      console.warn = originalWarn;
    }
  }

  {
    const currentProc = { ref: makeProc(1002) };
    const writes = [];
    let increments = 0;
    let decrements = 0;
    currentProc.ref.stdin.write = (line) => {
      writes.push(line);
      return true;
    };
    const router = loadRouter({
      currentProc,
      incrementPendingRequests: () => { increments += 1; },
      decrementPendingRequests: () => { decrements += 1; },
      env: {
        ANTARES_IPC_MAX_PENDING_REQUESTS: '2',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '5',
      },
    });

    const first = router._sendRequest('version', {});
    const second = router._sendRequest('formats', {});
    const rejectedRequest = router._sendRequest('canvas_list', {});
    const rejection = await getRejection(rejectedRequest);

    assert(rejection instanceof Error, 'global admission rejection is an Error');
    assert(rejection?.code === -32005 && rejection?.category === 'CAPACITY_EXCEEDED', 'global rejection has structured capacity fields');
    assert(rejection?.details?.retryable === true, 'global rejection is retryable');
    assert(rejection?.details?.reason === 'ipc_total_pending_limit', 'global rejection reports its reason');
    assert(rejection?.details?.pending === 2 && rejection?.details?.limit === 2, 'global rejection includes pending count and limit');
    assert(writes.length === 2, 'global rejection across methods does not write to stdin');
    assert(increments === 2 && decrements === 0, 'global rejection does not mutate spawner pending count');

    respond(currentProc.ref, writes[0]);
    respond(currentProc.ref, writes[1]);
    if (!rejection) respond(currentProc.ref, writes[2]);
    await Promise.all([first, second]);
    assert(decrements === 2, 'global accepted requests release after responses');
  }

  {
    const currentProc = { ref: makeProc(1003) };
    const writesA = [];
    let increments = 0;
    let decrements = 0;
    currentProc.ref.stdin.write = (line) => {
      writesA.push(line);
      return true;
    };
    const router = loadRouter({
      currentProc,
      incrementPendingRequests: () => { increments += 1; },
      decrementPendingRequests: () => { decrements += 1; },
      env: {
        ANTARES_IPC_MAX_PENDING_REQUESTS: '10',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '1',
      },
    });

    const firstProc = currentProc.ref;
    const first = router._sendRequest('canvas_get', { id: 'a' });
    const replacement = makeProc(1004);
    const writesB = [];
    replacement.stdin.write = (line) => {
      writesB.push(line);
      return true;
    };
    currentProc.ref = replacement;
    firstProc.emit('close', 1, null);
    let closed = false;
    try {
      await first;
    } catch (err) {
      closed = /Backend process exited/.test(err.message);
    }
    assert(closed, 'process close rejects the pending request');
    assert(decrements === 1, 'process close releases the accepted request once');

    const second = router._sendRequest('canvas_get', { id: 'b' });
    assert(writesB.length === 1, 'process close releases per-method capacity for replacement process');
    respond(replacement, writesB[0]);
    await second;
    assert(increments === 2 && decrements === 2, 'replacement request releases normally after process close');
  }

  {
    const currentProc = { ref: makeProc(1005) };
    const router = loadRouter({
      currentProc,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      env: {
        ANTARES_IPC_MAX_PENDING_REQUESTS: 'not-a-number',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '0',
      },
    });
    const limits = typeof router._getPendingRequestLimits === 'function'
      ? router._getPendingRequestLimits()
      : {};
    assert(limits.maxPendingRequests === 128, 'invalid total pending environment value uses default');
    assert(limits.maxPendingPerMethod === 32, 'zero per-method pending environment value uses default');

    const negativeRouter = loadRouter({
      currentProc,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      env: {
        ANTARES_IPC_MAX_PENDING_REQUESTS: '-1',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '-4',
      },
    });
    const negativeLimits = negativeRouter._getPendingRequestLimits();
    assert(negativeLimits.maxPendingRequests === 128, 'negative total pending environment value uses default');
    assert(negativeLimits.maxPendingPerMethod === 32, 'negative per-method pending environment value uses default');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
