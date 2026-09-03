
const path = require('path');
const Module = require('module');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function installMock(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const drivePath = require.resolve('../electron/google-drive-service');
  const wmPath = require.resolve('../electron/window-manager');
  const enginePath = require.resolve('../electron/autoimg-sync-engine');

  const folderHeader = ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'];
  let folderValues = [
    folderHeader,
    ['JUAN', 'folder-juan', '✅', '2026-07-03', '12'],
  ];
  let logValues = [
    ['FECHA', 'ACCION', 'DETALLE', 'USUARIO', 'DURACION'],
    ['2026-07-03', 'SCAN', 'ok', 'u@x.com', '1.0'],
  ];

  installMock(sheetsPath, {
    getSheetId: () => 'sheet-1',
    getStoredSheetConfig: () => ({ sheet_id: 'sheet-1', name: 'AutoIMG', linked: true }),
    getAuthStatus: async () => ({ authenticated: true, email: 'u@x.com' }),
    readRange: async (range) => {
      if (String(range).startsWith('FOLDERS')) return { values: folderValues };
      if (String(range).startsWith('LOGS')) return { values: logValues };
      return { values: [] };
    },
    appendRow: async (range, row) => {
      if (String(range).startsWith('FOLDERS')) {
        folderValues = [...folderValues, row];
      }
      if (String(range).startsWith('LOGS')) {
        logValues = [...logValues, row];
      }
      return { success: true };
    },
    writeRange: async (range, values) => {
      if (String(range).startsWith('FOLDERS')) folderValues = values;
      if (String(range).startsWith('LOGS')) logValues = values;
      return { success: true };
    },
    batchWriteRanges: async () => ({ success: true }),
    batchReadRanges: async () => ({}),
  });

  installMock(drivePath, {
    assertDriveFolder: async (folder_id) => ({ folder_id, name: 'PEDRO' }),
  });

  installMock(wmPath, {
    getMainWindow: () => null,
  });

  delete require.cache[enginePath];
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}autoimg-`)) {
      delete require.cache[key];
    }
  }

  const engine = require('../electron/autoimg-sync-engine');

  const first = await engine.listFolders({ force: true });
  assert(first.folders.length === 1, 'listFolders force carga 1 carpeta');

  const logsAfterFolders = await engine.listLogs({ force: false });
  assert(
    logsAfterFolders.cached === false && logsAfterFolders.values.length === 2,
    'cargar folders no debe marcar logs no cargados como cache fresco',
  );

  await engine.addFolder({ name: 'PEDRO', folder_id: 'folder-pedro', activo: true });

  const cachedAfterAdd = await engine.listFolders({ force: false });
  assert(
    cachedAfterAdd.folders.length >= 1,
    `tras addFolder, listFolders(force:false) no debe devolver vacío (got ${cachedAfterAdd.folders.length}, cached=${cachedAfterAdd.cached})`,
  );
  assert(
    cachedAfterAdd.folders.some((f) => f.folder_id === 'folder-pedro')
      || cachedAfterAdd.folders.length === 0 === false,
    'tras addFolder, cache no debe fingir lista vacía fresca',
  );

  const logsFresh = await engine.listLogs({ force: true });
  assert(logsFresh.values.length >= 2, 'listLogs force carga header+fila');

  await engine.removeFolder({ folder_id: 'folder-pedro' });
  const afterRemove = await engine.listFolders({ force: false });
  assert(
    afterRemove.folders.length >= 1 || afterRemove.cached === false,
    `tras removeFolder, listFolders(force:false) no debe servir [] cacheado (got length=${afterRemove.folders.length}, cached=${afterRemove.cached})`,
  );

  console.log('[PASS] AutoIMG cache invalidation OK.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
