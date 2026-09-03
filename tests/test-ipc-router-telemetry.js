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

function loadRouter() {
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
      getProcess: () => null,
      isReady: () => true,
      waitForReady: async () => true,
      getState: () => 'ready',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => true,
      incrementPendingRequests: () => {},
      decrementPendingRequests: () => {},
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
  return require(routerPath);
}

async function run() {
  console.log('Testing ipc-router telemetry + backpressure...\n');

  const {
    _writeStdinWithBackpressure,
    _estimateJsonBytes,
    _logIpcTelemetry,
    getIpcBackpressureWaits,
    resetIpcBackpressureWaits,
  } = loadRouter();

  resetIpcBackpressureWaits();
  assert(getIpcBackpressureWaits() === 0, 'backpressure counter starts at 0');

  {
    const stdin = new EventEmitter();
    stdin.write = () => true;
    const result = await _writeStdinWithBackpressure({ stdin }, 'x\n');
    assert(result.waitedForDrain === false, 'write()===true does not wait for drain');
    assert(getIpcBackpressureWaits() === 0, 'successful write does not increment backpressure waits');
  }

  {
    const stdin = new EventEmitter();
    stdin.write = () => undefined;
    const result = await _writeStdinWithBackpressure({ stdin }, 'x\n');
    assert(result.waitedForDrain === false, 'write()===undefined treated as success (no drain wait)');
  }

  {
    resetIpcBackpressureWaits();
    const stdin = new EventEmitter();
    stdin.write = () => false;
    const pending = _writeStdinWithBackpressure({ stdin }, 'big\n');
    setImmediate(() => stdin.emit('drain'));
    const result = await pending;
    assert(result.waitedForDrain === true, 'write()===false waits for drain');
    assert(getIpcBackpressureWaits() === 1, 'backpressure wait counter increments');
  }

  {
    const stdin = new EventEmitter();
    stdin.write = () => {
      throw new Error('EPIPE');
    };
    let threw = false;
    try {
      await _writeStdinWithBackpressure({ stdin }, 'x\n');
    } catch (err) {
      threw = /EPIPE/.test(err.message);
    }
    assert(threw, 'stdin write errors reject the promise');
  }

  {
    const bytes = _estimateJsonBytes({ a: 1, b: 'xy' });
    assert(bytes > 10, 'estimateJsonBytes returns positive size for objects');
    assert(_estimateJsonBytes(undefined) >= 0, 'estimateJsonBytes tolerates bad values');
  }

  {
    const previousWarn = console.warn;
    let telemetryLine = '';
    console.warn = (...args) => { telemetryLine = args.join(' '); };
    try {
      _logIpcTelemetry({
        method: 'canvas_save',
        requestId: 'req-observability',
        elapsedMs: 6_000,
        requestBytes: 120,
        responseBytes: 80,
        outcome: 'timeout',
      });
    } finally {
      console.warn = previousWarn;
    }
    assert(telemetryLine.includes('request_id=req-observability'), 'IPC telemetry includes request correlation');
    assert(telemetryLine.includes('outcome=timeout'), 'IPC telemetry includes normalized outcome');

    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (line) => warnings.push(line);
    try {
      _logIpcTelemetry({ method: 'version', elapsedMs: 0, outcome: 'error' });
      assert(warnings.length === 0, 'ordinary fast IPC errors remain filtered without verbose telemetry');

      _logIpcTelemetry({ method: 'version', elapsedMs: 0, outcome: 'rejected' });
      assert(warnings.some((line) => line.includes('outcome=rejected')), 'admission rejections bypass cheap telemetry filtering');
    } finally {
      console.warn = originalWarn;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
