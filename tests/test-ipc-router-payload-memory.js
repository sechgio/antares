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
