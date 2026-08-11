/**
 * Paridad de métodos nativos: electron/ipc-methods.js es la ÚNICA fuente de
 * verdad (NATIVE_METHODS). dialog-handlers.js y ipc-router.js deben derivar
 * de ella — nunca mantener listas inline (drift histórico probado: el cleanup
 * de file_staged tuvo que tocar las tres listas, commit 9f7a2ce).
 *
 * Agregar un método nativo = 1 edit en ipc-methods.js; estos checks fallan si
 * alguien vuelve a inlinear una lista o deriva mal.
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function setsEqual(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/**
 * ipc-router requires `electron`, `backend-spawner` and `window-manager` at
 * module top level; stub them in require.cache like the other router tests.
 */
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

function main() {
  console.log('Testing native-method allowlist parity...\n');

  const { NATIVE_METHODS: sourceNative, ALLOWED_RENDERER_METHODS } = require('../electron/ipc-methods');
  const { NATIVE_METHODS: dialogNative } = require('../electron/dialog-handlers');
  const { _DIALOG_NATIVE_METHODS } = loadRouter();

  // 1. La fuente es un array sin duplicados.
  check(
    Array.isArray(sourceNative) && new Set(sourceNative).size === sourceNative.length,
    'ipc-methods.NATIVE_METHODS es una lista sin duplicados'
  );
  const source = new Set(sourceNative);

  // 2. dialog-handlers deriva EXACTAMENTE de la fuente (ni más, ni menos).
  check(
    dialogNative instanceof Set,
    'dialog-handlers exporta NATIVE_METHODS como Set (derivado, no inline)'
  );
  check(
    setsEqual(dialogNative, source),
    'dialog-handlers.NATIVE_METHODS == ipc-methods.NATIVE_METHODS'
  );

  // 3. ipc-router deriva EXACTAMENTE: fuente menos el grupo dialog_* (que el
  //    dispatch ya captura por prefijo `startsWith('dialog_')`).
  const expectedRouterSet = new Set([...source].filter((m) => !m.startsWith('dialog_')));
  check(
    _DIALOG_NATIVE_METHODS instanceof Set,
    'ipc-router exporta _DIALOG_NATIVE_METHODS como Set (derivado, no inline)'
  );
  check(
    setsEqual(_DIALOG_NATIVE_METHODS, expectedRouterSet),
    'ipc-router._DIALOG_NATIVE_METHODS == NATIVE_METHODS sin dialog_*'
  );

  // 4. Todo método nativo está en la allowlist del renderer.
  const missingFromAllowlist = [...source].filter((m) => !ALLOWED_RENDERER_METHODS.has(m));
  check(
    missingFromAllowlist.length === 0,
    `todos los nativos están en ALLOWED_RENDERER_METHODS${missingFromAllowlist.length ? ` (faltan: ${missingFromAllowlist.join(', ')})` : ''}`
  );

  // 5. Ningún nativo se solapa con backend / autoimg / ubicaciones.
  const { BACKEND_METHODS } = require('../electron/ipc-methods');
  const { AUTOIMG_METHODS } = require('../electron/autoimg-ipc-methods');
  const { UBICACIONES_METHODS } = require('../electron/ubicaciones-ipc-methods');
  const disjoint = [...source].filter(
    (m) => BACKEND_METHODS.includes(m) || AUTOIMG_METHODS.has(m) || UBICACIONES_METHODS.has(m)
  );
  check(
    disjoint.length === 0,
    `nativos disjuntos de backend/autoimg/ubicaciones${disjoint.length ? ` (solapados: ${disjoint.join(', ')})` : ''}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
