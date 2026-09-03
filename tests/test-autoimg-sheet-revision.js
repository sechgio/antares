
const path = require('path');

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

  let sheetModifiedTime = '2026-07-01T10:00:00.000Z';
  let readRangesCalls = 0;
  let readRangeCalls = 0;

  const bdHeader = ['NIS', 'SGIO', 'DESTINO'];
  const bdRows = [bdHeader, ['4210801', '69656525', 'DVD 03']];
  const logRows = [['FECHA', 'ACCION'], ['2026-07-01', 'SYNC']];
  const arrastreRows = [['NIS', 'SGIO', 'MOTIVO', 'FECHA', 'OBSERVACION']];
  const folderRows = [
    ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'],
    ['JUAN', 'folderJuan01', '✅', '', '0'],
  ];

  installMock(sheetsPath, {
    getSheetId: () => 'sheetRevisionTest01',
    getStoredSheetConfig: () => ({ sheet_id: 'sheetRevisionTest01', name: 'AutoIMG', linked: true }),
    getAuthStatus: async () => ({ authenticated: true, email: 'u@x.com' }),
    openSpreadsheet: async () => ({ sheet_id: 'sheetRevisionTest01', name: 'AutoIMG' }),
    readRange: async (range) => {
      readRangeCalls += 1;
      if (String(range).startsWith('FOLDERS')) return { values: folderRows };
      if (String(range).startsWith('LOGS')) return { values: logRows };
      if (String(range).startsWith('BD_ARRASTRE')) return { values: arrastreRows };
      if (String(range).startsWith('BD_IMG')) return { values: bdRows };
      return { values: [] };
    },
    readRanges: async (ranges) => {
      readRangesCalls += 1;
      const out = {};
      for (const range of ranges) {
        if (String(range).startsWith('BD_IMG')) out[range] = bdRows;
        else if (String(range).startsWith('LOGS')) out[range] = logRows;
        else if (String(range).startsWith('BD_ARRASTRE')) out[range] = arrastreRows;
        else if (String(range).startsWith('FOLDERS')) out[range] = folderRows;
        else out[range] = [];
      }
      return out;
    },
    writeRange: async () => ({ success: true }),
    appendRow: async () => ({ success: true }),
    batchWriteRanges: async () => ({ success: true }),
  });

  installMock(drivePath, {
    getFileMetadata: async () => ({ modifiedTime: sheetModifiedTime, version: '7' }),
    assertDriveFolder: async (folder_id) => ({ folder_id, name: 'x' }),
  });

  installMock(wmPath, { getMainWindow: () => null });

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}autoimg-`)) {
      delete require.cache[key];
    }
  }
  delete require.cache[enginePath];

  const engine = require('../electron/autoimg-sync-engine');

  assert(engine.resolveRenameCopyConcurrency(5) === 3, 'pocos jobs → concurrency 3');
  assert(engine.resolveRenameCopyConcurrency(20) === 4, '15+ jobs → concurrency 4');
  assert(engine.resolveRenameCopyConcurrency(50) === 6, '40+ jobs → concurrency 6');

  const first = await engine.syncFromSheet();
  assert(first.success && first.cached === false, 'primer syncFromSheet lee sheet');
  assert(readRangesCalls === 1, `primer sync debe llamar readRanges 1 vez (got ${readRangesCalls})`);

  const CACHE_TTL_MS = 60_000;
  const second = await engine.syncFromSheet();
  assert(second.cached === true && second.revision_match === true, 'syncFromSheet con misma revision debe cachear');
  assert(readRangesCalls === 1, `segunda sync no debe readRanges (got ${readRangesCalls})`);

  sheetModifiedTime = '2026-07-02T12:00:00.000Z';
  const third = await engine.syncFromSheet();
  assert(third.cached === false, 'revision distinta debe refetch');
  assert(readRangesCalls === 2, `tercera sync debe readRanges (got ${readRangesCalls})`);

  readRangeCalls = 0;
  const foldersForce = await engine.listFolders({ force: true });
  assert(foldersForce.folders.length === 1, 'listFolders force carga');
  const beforeRev = readRangeCalls;
  const foldersCached = await engine.listFolders({ force: false });
  assert(foldersCached.cached === true, 'listFolders force:false con TTL fresco usa cache');
  sheetModifiedTime = '2026-07-03T00:00:00.000Z';
  await engine.listFolders({ force: true });
  const sameRev = await engine.listFolders({ force: false });
  assert(sameRev.cached === true, 'listFolders TTL fresco');

  void beforeRev;
  void CACHE_TTL_MS;

  console.log('[PASS] AutoIMG sheet revision cache + rename concurrency OK.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
