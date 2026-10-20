const { EventEmitter } = require('events');

const { assert, finish } = require('./helpers/harness');
const { loadIpcRouter } = require('./helpers/ipc-router');

function loadRouter() {
  return loadIpcRouter();
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
      assert(
        warnings.some((line) => line.includes('outcome=failed')),
        'fast IPC errors are always logged (normalized to failed)',
      );

      warnings.length = 0;
      _logIpcTelemetry({ method: 'version', elapsedMs: 0, outcome: 'rejected' });
      assert(warnings.some((line) => line.includes('outcome=rejected')), 'admission rejections bypass cheap telemetry filtering');

      _logIpcTelemetry({
        method: 'canvas_asset_put',
        elapsedMs: 12,
        requestBytes: 128,
        responseBytes: 0,
        outcome: 'rejected',
      });
      assert(warnings.some((line) => line.includes('method=canvas_asset_put') && line.includes('outcome=rejected')), 'native rejection logs to telemetry');
    } finally {
      console.warn = originalWarn;
    }
  }

  finish();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
