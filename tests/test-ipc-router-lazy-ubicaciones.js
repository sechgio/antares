const fs = require('fs');
const path = require('path');

const { assert, finish, stubModule, evictModule } = require('./helpers/harness');

function stubElectronAndDeps() {
  stubModule('electron', {
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    dialog: {},
    app: { isPackaged: true },
  });

  stubModule('electron/backend-spawner', {
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
  });

  stubModule('electron/window-manager', {
    getMainWindow: () => null,
    getIsDev: () => true,
  });

  stubModule('electron/dialog-handlers', { handleDialogCall: async () => ({ handled: false }), isUnderAllowedWriteRoot: (dir) => allowedWriteRoots.has(dir) });
}

const allowedWriteRoots = new Set();

function run() {
  console.log('Testing ipc-router lazy ubicaciones require...\n');

  const routerFile = path.join(__dirname, '../electron/ipc-router.js');
  const src = fs.readFileSync(routerFile, 'utf8');

  assert(
    /require\('\.\/ubicaciones-handlers'\)/.test(src),
    'ubicaciones-handlers is required lazily inside a call path',
  );
  assert(
    /require\('\.\/autoimg-handlers'\)/.test(src),
    'autoimg-handlers remains lazily required',
  );

  stubElectronAndDeps();
  const ubicacionesPath = require.resolve('../electron/ubicaciones-handlers');
  evictModule('electron/ubicaciones-handlers');

  const routerPath = require.resolve('../electron/ipc-router');
  evictModule('electron/ipc-router');
  require(routerPath);

  assert(
    !require.cache[ubicacionesPath],
    'requiring ipc-router does not populate ubicaciones-handlers in require.cache',
  );

  require(ubicacionesPath);
  assert(!!require.cache[ubicacionesPath], 'ubicaciones-handlers loads on demand');

  finish();
}

run();
