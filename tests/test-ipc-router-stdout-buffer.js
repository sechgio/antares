const assert = require('assert');
const path = require('path');

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
      isReady: () => false,
      waitForReady: async () => false,
      getState: () => 'starting',
      getLastError: () => null,
      getStderrTail: () => '',
      manualRestart: async () => false,
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

function run() {
  console.log('Testing ipc-router stdout Buffer framing...\n');

  const { _consumeStdoutLines } = loadRouter();
  assert.strictEqual(typeof _consumeStdoutLines, 'function', '_consumeStdoutLines exported');

  {
    const r = _consumeStdoutLines(Buffer.alloc(0), Buffer.from('{"a":1'));
    assert.ok(Buffer.isBuffer(r.pending), 'pending remains Buffer');
    assert.strictEqual(r.lines.length, 0, 'no complete line yet');
    assert.strictEqual(r.pending.toString('utf8'), '{"a":1');
  }

  {
    let state = Buffer.alloc(0);
    let r = _consumeStdoutLines(state, Buffer.from('{"id":1,"result":{"ok":tru'));
    state = r.pending;
    r = _consumeStdoutLines(state, Buffer.from('e}}\n{"id":2,"result":2}\n'));
    assert.strictEqual(r.lines.length, 2, 'two complete lines after second chunk');
    assert.strictEqual(r.lines[0].toString('utf8'), '{"id":1,"result":{"ok":true}}');
    assert.strictEqual(r.lines[1].toString('utf8'), '{"id":2,"result":2}');
    assert.strictEqual(r.pending.length, 0, 'no leftover');
  }

  {
    const r = _consumeStdoutLines(Buffer.alloc(0), 'hello\n');
    assert.ok(Buffer.isBuffer(r.pending), 'pending is Buffer even for string chunk');
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].toString('utf8'), 'hello');
  }

  {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'x', result: { data: 'á'.repeat(1000) } });
    const chunk = Buffer.from(`${payload}\n`, 'utf8');
    const r = _consumeStdoutLines(Buffer.alloc(0), chunk);
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].byteLength, Buffer.byteLength(payload, 'utf8'));
  }

  {
    const r = _consumeStdoutLines(Buffer.alloc(0), Buffer.from('a\n\nb\n'));
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].toString('utf8'), 'a');
    assert.strictEqual(r.lines[1].toString('utf8'), 'b');
  }

  {
    const small = Buffer.from('{"id":1,"result":1}\n');
    const r1 = _consumeStdoutLines(Buffer.alloc(0), small, 16);
    assert.strictEqual(r1.lines.length, 1, 'complete line parses before cap applies');
    assert.strictEqual(r1.dropped, false);

    const r2 = _consumeStdoutLines(Buffer.alloc(0), Buffer.from('{"bigger":'), 8);
    assert.strictEqual(r2.lines.length, 0);
    assert.strictEqual(r2.dropped, true, 'oversized partial line is dropped');
    assert.strictEqual(r2.pending.length, 0, 'pending reset after drop');

    const r3 = _consumeStdoutLines(Buffer.alloc(0), small, 8);
    assert.strictEqual(r3.lines.length, 1, 'next complete line still parses after a drop');
    assert.strictEqual(r3.dropped, false);
  }

  console.log('  ✓ Buffer framing + split lines + byteLength + maxPendingBytes cap');
  console.log('\nAll ipc-router stdout buffer tests passed.');
}

run();
