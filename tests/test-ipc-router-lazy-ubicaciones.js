/**
 * Cold-start: ipc-router must not load ubicaciones-handlers until first use.
 */
const fs = require('fs');
const path = require('path');

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

function stubElectronAndDeps() {
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

  const dialogPath = require.resolve('../electron/dialog-handlers');
  require.cache[dialogPath] = {
    id: dialogPath,
    filename: dialogPath,
    loaded: true,
    exports: { handleDialogCall: async () => ({ handled: false }) },
  };
}

function run() {
  console.log('Testing ipc-router lazy ubicaciones require...\n');

  const routerFile = path.join(__dirname, '../electron/ipc-router.js');
  const src = fs.readFileSync(routerFile, 'utf8');

  assert(
    !/^const \{ handleUbicacionesCall \} = require\('\.\/ubicaciones-handlers'\);/m.test(src),
    'no top-level require of ubicaciones-handlers',
  );
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
  delete require.cache[ubicacionesPath];

  const routerPath = require.resolve('../electron/ipc-router');
  delete require.cache[routerPath];
  require(routerPath);

  assert(
    !require.cache[ubicacionesPath],
    'requiring ipc-router does not populate ubicaciones-handlers in require.cache',
  );

  // First explicit require (simulates first IPC) loads the module.
  require(ubicacionesPath);
  assert(!!require.cache[ubicacionesPath], 'ubicaciones-handlers loads on demand');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
}

run();
