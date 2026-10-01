const assert = require('assert');
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
    getIsDev: () => true,
  });
  const routerPath = require.resolve('../electron/ipc-router');
  evictModule('electron/ipc-router');
  return require(routerPath);
}

function run() {
  const { _estimatePayloadBytes } = loadRouter();
  assert.strictEqual(typeof _estimatePayloadBytes, 'function');

  const strings = [
    '', 'ASCII', 'comillas: " y barra: \\', 'tab\tline\nreturn\rback\bf\f',
    Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join(''),
    'á中文🚀e\u0301', '\ud800', '\udfff', '"'.repeat(1000), '\u0000'.repeat(1000),
  ];
  for (const value of strings) {
    // Preserve the existing estimate, including its handling of lone surrogates.
    let expected = Buffer.byteLength(value, 'utf8') + 2;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code === 0x22 || code === 0x5c) expected += 1;
      else if (code < 0x20) expected += [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(code) ? 1 : 5;
    }
    assert.strictEqual(_estimatePayloadBytes(value), expected);
  }
  const nested = { 'quoted"key': ['á', '\n', { controls: '\u0001\t', text: '🚀' }], omitted: undefined };
  assert.strictEqual(_estimatePayloadBytes(nested), Buffer.byteLength(JSON.stringify(nested), 'utf8'));

  const originalStringify = JSON.stringify;
  JSON.stringify = () => {
    throw new Error('payload estimate must not stringify the payload');
  };
  try {
    assert.strictEqual(_estimatePayloadBytes(new Uint8Array(32)), 32);
    assert.strictEqual(_estimatePayloadBytes(new ArrayBuffer(17)), 17);
    assert.strictEqual(_estimatePayloadBytes('á\n'), 6);
  } finally {
    JSON.stringify = originalStringify;
  }
}

try {
  run();
  console.log('IPC payload memory tests passed.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
