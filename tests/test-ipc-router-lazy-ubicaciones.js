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
    exports: { handleDialogCall: async () => ({ handled: false }), isUnderAllowedWriteRoot: (dir) => allowedWriteRoots.has(dir) },
  };
}

// Write roots the stub dialog-handlers acknowledges (mutable per assertion).
const allowedWriteRoots = new Set();

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

  runRouterSmokeTests();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
}

/**
 * Smoke tests for the Ubicaciones IPC contract (frontend payload shape from
 * frontend/src/api.ts: previewUbicacion / generarUbicaciones):
 *  - excelPath must be a staged read token, never a raw absolute path
 *  - outputDir must be a write token or a path under an allowed write root
 */
function runRouterSmokeTests() {
  console.log('\nSmoke: Ubicaciones payload contract through the IPC router...\n');
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-router-smoke-'));
  const excelFile = path.join(tmp, 'datos.xlsx');
  fs.writeFileSync(excelFile, 'not really xlsx but exists');

  const {
    _maybeResolveFileTokens,
    _validateAndResolveWriteParams,
  } = require('../electron/ipc-router');
  const { createFileCapability, revokeCapability } = require('../electron/file-capabilities');

  // 1) Raw absolute excelPath (old frontend behavior) → rejected
  try {
    _maybeResolveFileTokens({ excelPath: excelFile, formato: 'vertical' }, null);
    assert(false, 'raw absolute excelPath must be rejected');
  } catch (e) {
    assert(/raw absolute paths not allowed/.test(e.message), `raw excelPath rejected: ${e.message}`);
  }

  // 2) Staged read token in excelPath → resolved to the real path
  const readCap = createFileCapability({ filePath: excelFile, mode: 'read', webContentsId: null });
  try {
    const resolved = _maybeResolveFileTokens({ excelPath: readCap.token, formato: 'vertical' }, null);
    assert(resolved.excelPath === excelFile, 'excelPath token resolved to backend path');
  } catch (e) {
    assert(false, `excelPath token resolution failed: ${e.message}`);
  } finally {
    revokeCapability(readCap.token);
  }

  // 3) Arbitrary outputDir (not chosen via dialog) → rejected
  const arbitrary = path.join(tmp, 'no-registrado');
  try {
    _validateAndResolveWriteParams({ excelPath: null, outputDir: arbitrary, consolidado: false }, null);
    assert(false, 'outputDir outside allowed write roots must be rejected');
  } catch (e) {
    assert(/no está permitida/.test(e.message), `arbitrary outputDir rejected: ${e.message}`);
  }

  // 4) outputDir under a dialog-registered write root → accepted as-is
  allowedWriteRoots.add(tmp);
  try {
    const out = path.join(tmp, 'salida');
    const params = _validateAndResolveWriteParams({ excelPath: null, outputDir: out, consolidado: false }, null);
    assert(params.outputDir === out, 'outputDir under write root passes through');
    assert(params._resolved_output_path === undefined, 'no token rewrite for raw root path');
  } catch (e) {
    assert(false, `outputDir under write root should pass: ${e.message}`);
  } finally {
    allowedWriteRoots.delete(tmp);
  }

  // 5) outputDir as a write token → rewritten to the capability path
  const writeCap = createFileCapability({ filePath: tmp, mode: 'write', webContentsId: null });
  try {
    const params = _validateAndResolveWriteParams({ excelPath: null, outputDir: writeCap.token, consolidado: false }, null);
    assert(params.outputDir === tmp, 'outputDir write token resolved to real path');
    assert(params._resolved_output_path === tmp, '_resolved_output_path set for backend');
  } catch (e) {
    assert(false, `outputDir write token should resolve: ${e.message}`);
  } finally {
    revokeCapability(writeCap.token);
  }

  // 6) Non-path payloads are untouched (manual-data mode)
  try {
    const manual = { excelPath: null, outputDir: undefined, manualData: { lat: -12.0, lon: -77.0 } };
    const out1 = _maybeResolveFileTokens({ ...manual }, null);
    const out2 = _validateAndResolveWriteParams(out1, null);
    assert(out2.excelPath === null, 'manual mode payload unchanged');
    assert(!!out2.manualData, 'manualData preserved');
  } catch (e) {
    assert(false, `manual payload should pass untouched: ${e.message}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

run();
