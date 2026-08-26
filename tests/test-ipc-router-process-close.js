// Regression: late close from a replaced backend must not detach the live process,
// but MUST reject pending requests that were sent on the dead process.
// Also: mid-flight retries only for idempotent methods.
const { EventEmitter } = require('events');

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

function makeFakeProc(pid) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: () => true,
    end: () => {},
  };
  proc.killed = false;
  proc.pid = pid;
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

function loadIpcRouter({
  currentProc,
  clearJobActivity,
  noteJobActivity,
  waitForReady,
  isReady,
  getState,
  incrementPendingRequests,
  decrementPendingRequests,
}) {
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
      isReady: isReady || (() => true),
      waitForReady: waitForReady || (async () => true),
      getState: getState || (() => 'ready'),
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests: incrementPendingRequests || (() => {}),
      decrementPendingRequests: decrementPendingRequests || (() => {}),
      noteJobActivity: noteJobActivity || (() => {}),
      clearJobActivity,
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
  return require(routerPath);
}

async function run() {
  console.log('Testing ipc-router process close identity...\n');

  // ── 4.1: attachment identity + pending reject on stale close ──
  {
    const currentProc = { ref: null };
    let clearCalls = 0;
    const { _ensureListeners, _sendRequest } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {
        clearCalls++;
      },
    });

    const procA = makeFakeProc(1001);
    const procB = makeFakeProc(1002);

    currentProc.ref = procA;
    assert(_ensureListeners() === true, 'attach listeners to process A');
    assert(procA.listenerCount('close') === 1, 'process A has one close listener');

    const pendingA = _sendRequest('canvas_get', { id: 'doc-1' });
    let pendingRejected = false;
    let pendingMsg = '';
    pendingA.catch((err) => {
      pendingRejected = true;
      pendingMsg = err.message || '';
    });

    currentProc.ref = procB;
    assert(_ensureListeners() === true, 'attach listeners to process B');
    assert(procB.listenerCount('close') === 1, 'process B has one close listener');

    clearCalls = 0;
    procA.emit('close', 1, null);
    await Promise.resolve();
    assert(clearCalls === 0, 'late close of A does not clear job activity');
    assert(pendingRejected, 'late close of A rejects pending requests tagged to A');
    assert(
      pendingMsg.includes('Backend process exited'),
      'pending reject message mentions process exit',
    );

    assert(_ensureListeners() === true, 'ensureListeners still true for B after A close');
    assert(procB.listenerCount('close') === 1, 'process B still has exactly one close listener');

    clearCalls = 0;
    procB.emit('close', 0, null);
    assert(clearCalls === 1, 'close of attached process clears job activity');

    const procC = makeFakeProc(1003);
    currentProc.ref = procC;
    assert(_ensureListeners() === true, 're-attach after real death');
    assert(procC.listenerCount('close') === 1, 'process C has one close listener');
  }

  // ── 4.1b: pending IPC admission is bounded ──
  console.log('\nTesting bounded pending IPC admission...\n');
  {
    const currentProc = { ref: null };
    const { _sendRequest, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
    });
    const proc = makeFakeProc(1201);
    currentProc.ref = proc;
    _ensureListeners();

    const originalSetTimeout = global.setTimeout;
    try {
      global.setTimeout = (fn, delay, ...args) => (
        delay === 30_000 ? originalSetTimeout(fn, 0, ...args) : originalSetTimeout(fn, delay, ...args)
      );

      const pending = Array.from({ length: 64 }, (_, index) => (
        _sendRequest(`burst_method_${index}`, {})
      ));
      pending.forEach((request) => request.catch(() => {}));
      const overflow = _sendRequest('burst_overflow', {});
      let overflowMessage = '';
      try {
        await overflow;
      } catch (err) {
        overflowMessage = err.message || '';
      }

      assert(
        overflowMessage.includes('IPC capacity exhausted'),
        'rejects a request when the global pending IPC limit is reached',
      );

      proc.emit('close', 1, null);
      await Promise.allSettled(pending);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  }

  // ── 4.1c: one method cannot monopolize pending IPC ──
  {
    const currentProc = { ref: null };
    const { _sendRequest, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
    });
    const proc = makeFakeProc(1202);
    currentProc.ref = proc;
    _ensureListeners();

    const originalSetTimeout = global.setTimeout;
    try {
      global.setTimeout = (fn, delay, ...args) => (
        delay === 30_000 ? originalSetTimeout(fn, 0, ...args) : originalSetTimeout(fn, delay, ...args)
      );

      const pending = Array.from({ length: 16 }, () => _sendRequest('same_method', {}));
      pending.forEach((request) => request.catch(() => {}));
      const overflow = _sendRequest('same_method', {});
      let overflowMessage = '';
      try {
        await overflow;
      } catch (err) {
        overflowMessage = err.message || '';
      }

      assert(
        overflowMessage.includes('IPC capacity exhausted for "same_method"'),
        'rejects a request when a method-specific pending IPC limit is reached',
      );

      proc.emit('close', 1, null);
      await Promise.allSettled(pending);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  }

  // ── 4.1d: startup wait admission is bounded too ──
  {
    const currentProc = { ref: null };
    let releaseReady;
    const readyGate = new Promise((resolve) => { releaseReady = resolve; });
    const { _callBackend } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
      isReady: () => false,
      waitForReady: () => readyGate,
    });
    const proc = makeFakeProc(1203);
    currentProc.ref = proc;

    const pending = Array.from({ length: 64 }, (_, index) => (
      _callBackend(`startup_method_${index}`, {})
    ));
    pending.forEach((request) => request.catch(() => {}));
    const overflow = _callBackend('startup_overflow', {});
    let overflowMessage = '';
    await Promise.race([
      overflow.catch((err) => { overflowMessage = err.message || ''; }),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);

    assert(
      overflowMessage.includes('IPC capacity exhausted'),
      'rejects a request while the backend readiness queue is full',
    );

    releaseReady();
    await Promise.resolve();
    proc.emit('close', 1, null);
    await Promise.allSettled(pending);
  }

  // ── 4.2: timeout + late stdin failure release exactly once ──
  console.log('\nTesting idempotent pending-request release...\n');
  {
    const currentProc = { ref: null };
    let incrementCalls = 0;
    let decrementCalls = 0;
    const { _sendRequest, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
      incrementPendingRequests: () => {
        incrementCalls++;
      },
      decrementPendingRequests: () => {
        decrementCalls++;
      },
    });

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn, delay, ...args) => (
      delay === 30_000 ? originalSetTimeout(fn, 0, ...args) : originalSetTimeout(fn, delay, ...args)
    );

    try {
      const proc = makeFakeProc(1501);
      const stdin = new EventEmitter();
      stdin.end = () => {};
      stdin.write = () => {
        originalSetTimeout(() => stdin.emit('error', new Error('late EPIPE')), 10);
        return false;
      };
      proc.stdin = stdin;
      currentProc.ref = proc;
      _ensureListeners();

      let rejected = false;
      try {
        await _sendRequest('version', {});
      } catch (err) {
        rejected = /IPC timeout: version/.test(err.message);
      }
      await new Promise((resolve) => originalSetTimeout(resolve, 20));

      assert(incrementCalls === 1, 'request increments pending count once');
      assert(rejected, 'timeout rejects the request before the late stdin error');
      assert(decrementCalls === 1, 'timeout and late stdin error release the request once');
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  }

  // ── 4.3: mid-flight retries only for idempotent methods ──
  console.log('\nTesting mid-flight retry idempotency...\n');
  {
    const currentProc = { ref: null };
    const { _isIdempotentMethod } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
    });

    assert(_isIdempotentMethod('canvas_get') === true, 'canvas_get is idempotent');
    assert(_isIdempotentMethod('canvas_list') === true, 'canvas_list is idempotent');
    assert(_isIdempotentMethod('process_status') === true, 'process_status is idempotent');
    assert(_isIdempotentMethod('version') === true, 'version is idempotent');
    assert(_isIdempotentMethod('process_start') === false, 'process_start is NOT idempotent');
    assert(_isIdempotentMethod('db_import') === false, 'db_import is NOT idempotent');
    assert(_isIdempotentMethod('canvas_save') === false, 'canvas_save is NOT idempotent');
    assert(_isIdempotentMethod('process_cancel') === false, 'process_cancel is NOT idempotent');
  }

  // Non-idempotent: process dies mid-flight → no retry (single write).
  {
    const currentProc = { ref: null };
    let writeCount = 0;
    let waitCalls = 0;
    const { _callBackend, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
      waitForReady: async () => {
        waitCalls++;
        return true;
      },
    });

    const proc = makeFakeProc(2001);
    proc.stdin.write = () => {
      writeCount++;
      process.nextTick(() => proc.emit('close', 1, null));
      return true;
    };
    currentProc.ref = proc;
    _ensureListeners();

    let threw = false;
    try {
      await _callBackend('process_start', { files: [] });
    } catch (err) {
      threw = true;
      assert(
        (err.message || '').includes('Backend process exited'),
        'non-idempotent fails with process-exited error',
      );
    }
    assert(threw, 'non-idempotent method throws on mid-flight exit');
    assert(writeCount === 1, 'non-idempotent method is not retried (one write)');
    assert(waitCalls === 0, 'non-idempotent does not waitForReady for retry');
  }

  // Idempotent: process dies mid-flight → retries once and succeeds.
  {
    const currentProc = { ref: null };
    let writeCount = 0;
    let waitCalls = 0;
    let ensureFn = null;

    const { _callBackend, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
      waitForReady: async () => {
        waitCalls++;
        const proc = makeFakeProc(2200 + writeCount);
        proc.stdin.write = (payload) => {
          writeCount++;
          process.nextTick(() => {
            try {
              const req = JSON.parse(String(payload).trim());
              proc.stdout.emit(
                'data',
                Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\n'),
              );
            } catch {
              /* ignore */
            }
          });
          return true;
        };
        currentProc.ref = proc;
        ensureFn();
        return true;
      },
    });
    ensureFn = _ensureListeners;

    const first = makeFakeProc(2199);
    first.stdin.write = () => {
      writeCount++;
      process.nextTick(() => first.emit('close', 1, null));
      return true;
    };
    currentProc.ref = first;
    _ensureListeners();

    const result = await _callBackend('canvas_get', { id: 'x' });
    assert(result && result.ok === true, 'idempotent method succeeds after retry');
    assert(writeCount === 2, 'idempotent method retried once (two writes)');
    assert(waitCalls >= 1, 'idempotent waits for backend before retry');
  }

  // process_start with started:true marks job activity without waiting for heartbeat.
  {
    const currentProc = { ref: null };
    let noteCalls = 0;
    const { _sendRequest, _ensureListeners } = loadIpcRouter({
      currentProc,
      clearJobActivity: () => {},
      noteJobActivity: () => {
        noteCalls += 1;
      },
    });

    const proc = makeFakeProc(3001);
    proc.stdin.write = (payload) => {
      process.nextTick(() => {
        const req = JSON.parse(String(payload).trim());
        proc.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { started: true, job_id: 'default' },
            }) + '\n',
          ),
        );
      });
      return true;
    };
    currentProc.ref = proc;
    _ensureListeners();

    const result = await _sendRequest('process_start', { files: ['a.jpg'], destino: 'out' });
    assert(result && result.started === true, 'process_start resolves with started:true');
    assert(noteCalls === 1, 'noteJobActivity called once when process_start starts');

    noteCalls = 0;
    proc.stdin.write = (payload) => {
      process.nextTick(() => {
        const req = JSON.parse(String(payload).trim());
        proc.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { started: false, reason: 'already_running' },
            }) + '\n',
          ),
        );
      });
      return true;
    };
    await _sendRequest('process_start', { files: ['a.jpg'], destino: 'out' });
    assert(noteCalls === 0, 'noteJobActivity skipped when process_start does not start');

    noteCalls = 0;
    proc.stdin.write = (payload) => {
      process.nextTick(() => {
        const req = JSON.parse(String(payload).trim());
        proc.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\n'),
        );
      });
      return true;
    };
    await _sendRequest('version', {});
    assert(noteCalls === 0, 'noteJobActivity not called for unrelated methods');
  }

  {
    // Regression: plain-object throws from ipcMain.handle become
    // "Error invoking remote method 'ipc-call': [object Object]" in the renderer.
    delete require.cache[require.resolve('../electron/ipc-router')];
    const { _toRendererIpcError, ANTARES_IPC_ERROR_PREFIX } = require('../electron/ipc-router');
    const err = new Error('Template not found: report.html');
    err.code = -32000;
    err.category = 'INTERNAL_ERROR';
    const wrapped = _toRendererIpcError(err);
    assert(wrapped instanceof Error, 'renderer error is an Error instance');
    assert(wrapped.message.startsWith(ANTARES_IPC_ERROR_PREFIX), 'message uses ANTARES_IPC_ERROR prefix');
    const payload = JSON.parse(wrapped.message.slice(ANTARES_IPC_ERROR_PREFIX.length));
    assert(payload.message === 'Template not found: report.html', 'payload preserves backend message');
    assert(payload.code === -32000, 'payload preserves code');
    assert(payload.category === 'INTERNAL_ERROR', 'payload preserves category');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
