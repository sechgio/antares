const assert = require('assert');
const path = require('path');

const { stubModule, evictModule } = require('./helpers/harness');

function loadRouter() {
  stubModule('electron', {
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    dialog: {},
    app: { isPackaged: true },
  });

  stubModule('electron/backend-spawner', {
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
  });

  stubModule('electron/window-manager', {
    getMainWindow: () => null,
    buildAppMenu: () => ({ popup: () => {} }),
    getIsDev: () => true,
  });

  const routerPath = require.resolve('../electron/ipc-router');
  evictModule('electron/ipc-router');
  return require(routerPath);
}

const emptyPending = () => ({ bufs: [], len: 0 });

function run() {
  console.log('Testing ipc-router stdout Buffer framing...\n');

  const { _consumeStdoutLines } = loadRouter();
  assert.strictEqual(typeof _consumeStdoutLines, 'function', '_consumeStdoutLines exported');

  {
    const r = _consumeStdoutLines(emptyPending(), Buffer.from('{"a":1'));
    assert.deepStrictEqual(r.pending.bufs.length, 1, 'pending accumulates bufs');
    assert.strictEqual(r.lines.length, 0, 'no complete line yet');
    assert.strictEqual(Buffer.concat(r.pending.bufs, r.pending.len).toString('utf8'), '{"a":1');
  }

  {
    let state = emptyPending();
    let r = _consumeStdoutLines(state, Buffer.from('{"id":1,"result":{"ok":tru'));
    state = r.pending;
    r = _consumeStdoutLines(state, Buffer.from('e}}\n{"id":2,"result":2}\n'));
    assert.strictEqual(r.lines.length, 2, 'two complete lines after second chunk');
    assert.strictEqual(r.lines[0].toString('utf8'), '{"id":1,"result":{"ok":true}}');
    assert.strictEqual(r.lines[1].toString('utf8'), '{"id":2,"result":2}');
    assert.strictEqual(r.pending.len, 0, 'no leftover');
  }

  {
    const r = _consumeStdoutLines(emptyPending(), 'hello\n');
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].toString('utf8'), 'hello');
    assert.strictEqual(r.pending.len, 0);
  }

  {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'x', result: { data: 'á'.repeat(1000) } });
    const chunk = Buffer.from(`${payload}\n`, 'utf8');
    const r = _consumeStdoutLines(emptyPending(), chunk);
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].byteLength, Buffer.byteLength(payload, 'utf8'));
  }

  {
    const r = _consumeStdoutLines(emptyPending(), Buffer.from('a\n\nb\n'));
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].toString('utf8'), 'a');
    assert.strictEqual(r.lines[1].toString('utf8'), 'b');
  }

  {
    const small = Buffer.from('{"id":1,"result":1}\n');
    const r1 = _consumeStdoutLines(emptyPending(), small, 16);
    assert.strictEqual(r1.lines.length, 1, 'complete line parses before cap applies');
    assert.strictEqual(r1.dropped, false);

    const r2 = _consumeStdoutLines(emptyPending(), Buffer.from('{"bigger":'), 8);
    assert.strictEqual(r2.lines.length, 0);
    assert.strictEqual(r2.dropped, true, 'oversized partial line is dropped');
    assert.strictEqual(r2.pending.len, 0, 'pending reset after drop');

    const r3 = _consumeStdoutLines(emptyPending(), small, 8);
    assert.strictEqual(r3.lines.length, 1, 'next complete line still parses after a drop');
    assert.strictEqual(r3.dropped, false);
  }

  {
    let state = emptyPending();
    let r = _consumeStdoutLines(state, Buffer.from('{"part":"a'), 64);
    state = r.pending;
    r = _consumeStdoutLines(state, Buffer.from('bc"}\n{"part":"de'), 64);
    assert.strictEqual(r.lines.length, 1, 'line spanning three chunks parses');
    assert.strictEqual(r.lines[0].toString('utf8'), '{"part":"abc"}');
    state = r.pending;
    r = _consumeStdoutLines(state, Buffer.from('f"}\n'), 64);
    assert.strictEqual(r.lines[0].toString('utf8'), '{"part":"def"}');
    assert.strictEqual(r.pending.len, 0);
  }

  console.log('  ✓ Buffer framing + split lines + byteLength + maxPendingBytes cap');
  console.log('\nAll ipc-router stdout buffer tests passed.');
}

run();
