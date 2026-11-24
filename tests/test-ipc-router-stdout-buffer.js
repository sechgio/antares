const assert = require('assert');
const { loadIpcRouter } = require('./helpers/ipc-router');

function loadRouter() {
  return loadIpcRouter({
    ready: false,
  });
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

  {
    let seed = 7;
    const rand = (n) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const expected = [];
    for (let i = 0; i < 400; i += 1) {
      expected.push(JSON.stringify({ id: i, result: 'ñá🚀'.repeat(rand(40)) + 'x'.repeat(rand(3000)) }));
    }
    expected.splice(200, 0, JSON.stringify({ id: 'big', result: 'z'.repeat(6 * 1024 * 1024) }));
    const stream = Buffer.from(expected.map((line, i) => (i % 50 === 0 ? `\n${line}` : line)).join('\n') + '\n');
    let state = emptyPending();
    const got = [];
    for (let offset = 0; offset < stream.length; ) {
      const size = rand(5) === 0 ? 1 + rand(8) : 1 + rand(256 * 1024);
      const r = _consumeStdoutLines(state, stream.subarray(offset, offset + size), 68 * 1024 * 1024);
      assert.strictEqual(r.dropped, false);
      for (const line of r.lines) got.push(line.toString('utf8'));
      state = r.pending;
      offset += size;
    }
    assert.strictEqual(state.len, 0, 'no leftover after random chunking');
    assert.deepStrictEqual(got, expected, 'random chunk boundaries reproduce every line byte-for-byte');
  }

  console.log('  ✓ Buffer framing + split lines + byteLength + maxPendingBytes cap');
  console.log('\nAll ipc-router stdout buffer tests passed.');
}

run();
