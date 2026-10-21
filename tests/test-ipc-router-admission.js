const { EventEmitter } = require('events');

const { assert, finish } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');

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

function loadRouter({ currentProc, incrementPendingRequests, decrementPendingRequests, env = {}, mainWindow = null, isDev = true }) {
  const oldEnv = new Map(Object.entries(env).map(([key]) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const router = loadIpcRouter({
    electron: {
      app: { isPackaged: !isDev },
    },
    backend: {
      getProcess: () => currentProc.ref,
      incrementPendingRequests,
      decrementPendingRequests,
    },
    windowManager: {
      getMainWindow: () => mainWindow,
      getIsDev: () => isDev,
    },
  });

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
    const proc = makeProc(990);
    const writes = [];
    proc.stdin.write = (line) => { writes.push(line); return true; };
    const router = loadRouter({ currentProc: { ref: proc }, incrementPendingRequests: () => {}, decrementPendingRequests: () => {},
      env: { ANTARES_IPC_MAX_PENDING_PER_METHOD: '1' } });
    const first = router._sendRequest('version', {});
    let serialized = 0;
    const rejected = await getRejection(router._sendRequest('version', { toJSON: () => { serialized += 1; return {}; } }));
    assert(rejected?.category === 'CAPACITY_EXCEEDED' && serialized === 0, 'count admission rejects before serializing parameters');
    respond(proc, writes[0]);
    await first;
    const circular = {}; circular.self = circular;
    assert(await getRejection(router._sendRequest('version', circular)) instanceof Error, 'serialization failures reject asynchronously');
    const next = router._sendRequest('version', {});
    assert(writes.length === 2, 'serialization failure releases the reserved method slot');
    respond(proc, writes[1]);
    await next;
  }

  {
    const proc = makeProc(991);
    const writes = [];
    proc.stdin.write = (line) => { writes.push(line); return false; };
    const router = loadRouter({ currentProc: { ref: proc }, incrementPendingRequests: () => {}, decrementPendingRequests: () => {} });
    const first = router._sendRequest('version', {});
    const blocked = await getRejection(router._sendRequest('formats', {}));
    assert(blocked?.details?.reason === 'ipc_stdin_backpressure' && writes.length === 1, 'backpressure prevents concurrent writes until drain');
    proc.stdin.emit('drain');
    respond(proc, writes[0]);
    await first;
    proc.stdin.write = (line) => { writes.push(line); return true; };
    const next = router._sendRequest('formats', {});
    respond(proc, writes[1]);
    await next;
    assert(writes.length === 2, 'drain releases stdin admission');
  }

  {
    const proc = makeProc(992);
    const writes = [];
    proc.stdin.write = (line) => { writes.push(line); return true; };
    const router = loadRouter({ currentProc: { ref: proc }, incrementPendingRequests: () => {}, decrementPendingRequests: () => {} });
    const payload = 'x'.repeat(33 * 1024 * 1024);
    const first = router._sendRequest('version', { payload });
    let serialized = 0;
    const rejected = await getRejection(router._sendRequest('formats', { payload, toJSON() { serialized += 1; return { payload }; } }));
    assert(rejected?.details?.reason === 'ipc_pending_bytes_limit', 'aggregate serialized requests have a byte budget');
    assert(serialized === 0 && writes.length === 1, 'byte admission rejects before allocating another serialized request');
    respond(proc, writes[0]);
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    const next = router._sendRequest('formats', { payload });
    assert(writes.length === 2, 'completed request releases its byte reservation');
    respond(proc, writes[1]);
    await next;
  }

  {
    const proc = makeProc(993);
    const writes = [];
    proc.stdin.write = (line) => { writes.push(line); return false; };
    const currentProc = { ref: proc };
    const router = loadRouter({ currentProc, incrementPendingRequests: () => {}, decrementPendingRequests: () => {} });
    const first = router._sendRequest('version', { payload: 'x'.repeat(33 * 1024 * 1024) });
    const closed = first.catch((error) => error);
    proc.emit('close', 1, null);
    assert(await closed instanceof Error, 'process close rejects a request waiting for drain');
    await new Promise((resolve) => setImmediate(resolve));
    assert(proc.stdin.listenerCount('drain') === 0 && proc.stdin.listenerCount('error') === 0, 'process close removes drain listeners');
    const replacement = makeProc(994);
    replacement.stdin.write = (line) => { writes.push(line); return true; };
    currentProc.ref = replacement;
    const next = router._sendRequest('version', { payload: 'x'.repeat(33 * 1024 * 1024) });
    assert(writes.length === 2, 'process close releases bytes for a replacement backend');
    respond(replacement, writes[1]);
    await next;
  }

  {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const trustedFrame = {
      url: pathToFileURL(path.join(__dirname, '..', 'frontend', 'dist', 'index.html')).toString(),
      parent: null,
    };
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { id: 7, mainFrame: trustedFrame },
    };
    const router = loadRouter({
      currentProc: { ref: makeProc(1000) },
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
      mainWindow,
      isDev: false,
    });

    assert(
      router._isAllowedIpcSender({
        sender: { id: 7, mainFrame: trustedFrame },
        senderFrame: trustedFrame,
      }) === true,
      'packaged IPC accepts the exact main renderer frame',
    );
    assert(
      router._isAllowedIpcSender({
        sender: { id: 7, mainFrame: { url: 'file:///C:/evil.html', parent: null } },
        senderFrame: { url: 'file:///C:/evil.html', parent: null },
      }) === false,
      'packaged IPC rejects arbitrary file URLs',
    );
    assert(
      router._isAllowedIpcSender({
        sender: { id: 8, mainFrame: trustedFrame },
        senderFrame: trustedFrame,
      }) === false,
      'packaged IPC rejects a different webContents',
    );
  }

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
        ANTARES_IPC_MAX_PENDING_REQUESTS: '3',
        ANTARES_IPC_MAX_PENDING_PER_METHOD: '2',
      },
    });

    const attempts = [];
    for (let index = 0; index < 30; index += 1) {
      const request = router._sendRequest(index % 2 === 0 ? 'version' : 'formats', { index });
      attempts.push(request.then(
        (value) => ({ value }),
        (error) => ({ error }),
      ));
    }
    await new Promise((resolve) => setImmediate(resolve));

    const rejected = await Promise.all(attempts.slice(3));
    assert(writes.length === 3, '10x burst keeps stdin writes at the global limit');
    assert(increments === 3 && decrements === 0, '10x burst keeps spawner pending count at the global limit');
    assert(rejected.length === 27 && rejected.every(({ error }) => error instanceof Error), '10x burst rejects excess requests');
    assert(
      rejected.every(({ error }) => error?.code === -32005
        && error?.category === 'CAPACITY_EXCEEDED'
        && error?.details?.retryable === true
        && error?.details?.reason === 'ipc_total_pending_limit'),
      '10x burst rejections preserve structured retryable capacity errors',
    );

    for (const write of writes) respond(currentProc.ref, write);
    const settled = await Promise.all(attempts);
    assert(settled.slice(0, 3).every(({ value }) => value?.ok === true), '10x burst accepted requests resolve');
    assert(decrements === 3, '10x burst releases every accepted request once');

    const afterRelease = router._sendRequest('version', {});
    assert(writes.length === 4 && increments === 4, '10x burst capacity is available after responses');
    respond(currentProc.ref, writes[3]);
    await afterRelease;
    assert(decrements === 4, 'post-burst request releases cleanly');
  }

  {
    const currentProc = { ref: makeProc(1006) };
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
    assert(limits.maxPendingRequests === 64, 'invalid total pending environment value uses default');
    assert(limits.maxPendingPerMethod === 8, 'zero per-method pending environment value uses default');

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
    assert(negativeLimits.maxPendingRequests === 64, 'negative total pending environment value uses default');
    assert(negativeLimits.maxPendingPerMethod === 8, 'negative per-method pending environment value uses default');
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
