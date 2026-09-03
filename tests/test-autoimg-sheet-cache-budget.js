
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

function clearAutoimgModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}autoimg-`)) {
      delete require.cache[key];
    }
  }
}

async function main() {
  const sheetsPath = require.resolve('../electron/google-sheets-service');
  const drivePath = require.resolve('../electron/google-drive-service');
  const wmPath = require.resolve('../electron/window-manager');
  const enginePath = require.resolve('../electron/autoimg-sync-engine');

  let sheetModifiedTime = '2026-08-06T10:00:00.000Z';
  let readRangesCalls = 0;
  let readRangeCalls = 0;
  let scanFoldersCalls = 0;

  const bdHeader = ['NIS', 'SGIO', 'DESTINO', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const smallBd = [bdHeader, ['4210801', '69656525', 'DVD 03', '', '', '', '', '', '', '', '', '', '']];
  const fatCell = 'X'.repeat(2048);
  const largeBd = [bdHeader];
  for (let i = 0; i < 80; i += 1) {
    largeBd.push([
      `nis-${i}`,
      `sgio-${i}`,
      'DVD',
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
      fatCell,
    ]);
  }

  let bdRows = smallBd;
  const logRows = [['FECHA', 'ACCION'], ['2026-08-06', 'SYNC']];
  const arrastreRows = [['NIS', 'SGIO', 'MOTIVO', 'FECHA', 'OBSERVACION']];
  const folderRows = [
    ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'],
    ['JUAN', 'folderJuan01', '✅', '', '0'],
  ];

  installMock(sheetsPath, {
    getSheetId: () => 'sheetCacheBudget01',
    getStoredSheetConfig: () => ({ sheet_id: 'sheetCacheBudget01', name: 'AutoIMG', linked: true }),
    getAuthStatus: async () => ({ authenticated: true, email: 'u@x.com' }),
    openSpreadsheet: async () => ({ sheet_id: 'sheetCacheBudget01', name: 'AutoIMG' }),
    readRange: async (range) => {
      readRangeCalls += 1;
      if (String(range).startsWith('FOLDERS')) return { values: folderRows };
      if (String(range).startsWith('LOGS')) return { values: logRows };
      if (String(range).startsWith('BD_ARRASTRE')) return { values: arrastreRows };
      if (String(range).startsWith('BD_IMG')) return { values: bdRows };
      if (String(range).startsWith('CONFIG')) return { values: [['AUTO_SYNC', 'false']] };
      if (String(range).startsWith('RESUMEN')) return { values: [['METRICA', 'VALOR']] };
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
        else if (String(range).startsWith('CONFIG')) out[range] = [['AUTO_SYNC', 'false']];
        else if (String(range).startsWith('RESUMEN')) out[range] = [['METRICA', 'VALOR']];
        else out[range] = [];
      }
      return out;
    },
    writeRange: async () => ({ success: true }),
    appendRow: async () => ({ success: true }),
    batchWriteRanges: async () => ({ success: true }),
  });

  const nis = require('../electron/autoimg-nis');

  installMock(drivePath, {
    getFileMetadata: async () => ({ modifiedTime: sheetModifiedTime, version: '1' }),
    assertDriveFolder: async (folder_id) => ({ folder_id, name: 'JUAN' }),
    listFolder: async (_folderId, opts = {}) => {
      scanFoldersCalls += 1;
      if (typeof opts.onPage === 'function') {
        opts.onPage({ pageFiles: [], totalSoFar: 0, hasMore: false });
      }
      return { files: [] };
    },
    parseDedupStrategy: nis.parseDedupStrategy,
    mergeNisMaps: nis.mergeNisMaps,
    computeEstado: nis.computeEstado,
  });

  installMock(wmPath, { getMainWindow: () => null });

  clearAutoimgModules();
  delete require.cache[enginePath];
  const engine = require('../electron/autoimg-sync-engine');

  assert(engine.SHEET_CACHE_BUDGET_BYTES === 32 * 1024 * 1024, 'presupuesto por defecto 32 MiB');

  engine.__resetSheetCacheForTests();
  bdRows = smallBd;
  const under = await engine.syncFromSheet();
  assert(under.success && under.rows.length === 2, 'sync bajo límite devuelve filas completas');
  assert(!under.cache_skipped, 'lote pequeño no debe marcar cache_skipped');
  const inspectUnder = engine.__inspectSheetCacheForTests();
  assert(inspectUnder.bdImgLen === 2, 'lote pequeño retenido en memoria');

  const cachedAgain = await engine.syncFromSheet();
  assert(cachedAgain.cached === true && cachedAgain.revision_match === true, 'segunda sync usa cache');
  assert(readRangesCalls === 1, `bajo límite no debe re-leer (got ${readRangesCalls})`);

  engine.__resetSheetCacheForTests();
  engine.__setSheetCacheBudgetForTests(8 * 1024);
  bdRows = largeBd;
  sheetModifiedTime = '2026-08-06T11:00:00.000Z';
  readRangesCalls = 0;

  const over = await engine.syncFromSheet();
  assert(over.success, 'sync grande exitoso');
  assert(over.rows.length === largeBd.length, 'respuesta grande completa (sin truncar)');
  assert(over.cache_skipped === true, 'lote grande marca cache_skipped');
  const inspectOver = engine.__inspectSheetCacheForTests();
  assert(inspectOver.bdImgLen === 0, 'lote grande no retenido');
  assert(inspectOver.logsLen === 0, 'caches previas invalidadas al superar presupuesto');

  const overAgain = await engine.syncFromSheet();
  assert(overAgain.rows.length === largeBd.length, 'reconsulta grande sigue completa');
  assert(overAgain.cache_skipped === true, 'reconsulta grande no retiene');
  assert(readRangesCalls === 2, `reconsulta grande debe re-leer (got ${readRangesCalls})`);
  assert(engine.__inspectSheetCacheForTests().bdImgLen === 0, 'sigue sin retener tras reconsulta');

  bdRows = smallBd;
  sheetModifiedTime = '2026-08-06T12:00:00.000Z';
  engine.__setSheetCacheBudgetForTests(null);
  const backSmall = await engine.syncFromSheet();
  assert(backSmall.rows.length === 2, 'vuelta a lote pequeño completa');
  assert(backSmall.rows[1][0] === '4210801', 'datos frescos, no truncados/obsoletos');
  assert(engine.__inspectSheetCacheForTests().bdImgLen === 2, 'lote pequeño se retiene de nuevo');

  engine.__resetSheetCacheForTests();
  const scan = await engine.scanAll();
  assert(scan && typeof scan === 'object', 'scanAll responde');
  const sync = await engine.syncToSheet();
  assert(sync.success === true, 'syncToSheet tras scanAll ok');
  assert(typeof sync.updated === 'number', 'syncToSheet expone updated');
  assert(typeof sync.new_rows === 'number', 'syncToSheet expone new_rows');

  console.log('[PASS] test-autoimg-sheet-cache-budget');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
