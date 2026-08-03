/**
 * Regresión: helpers de sync AutoIMG (NOTAS, sin_sgio, dedup ya cubierto en drive).
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

async function main() {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let timerHandle = null;
  let clearCount = 0;
  global.setInterval = (callback, delay) => {
    timerHandle = { callback, delay };
    return timerHandle;
  };
  global.clearInterval = (handle) => {
    if (handle === timerHandle) clearCount++;
  };

  try {
    const {
      buildFolderErrorSummary,
      formatFolderErrorScan,
      setAutoSync,
      cleanupAutoSync,
    } = require('../electron/autoimg-sync-engine');
    const {
      resolveNotasForSync,
      countSinSgioRows,
      countBdImgEstadoMetrics,
      countScanSinSgio,
      buildNisRowIndexMap,
      applyScanResultsToRows,
      buildScanResultRow,
      parseArrastreRows,
      parseFoldersFromValues,
      parseResumenMetrics,
      configValueFromRows,
    } = require('../electron/autoimg-sheet-rows');

    const autoSync = await setAutoSync(true);
    assert(autoSync.enabled === true, 'setAutoSync activa el auto-sync');
    assert(timerHandle && timerHandle.delay === 5 * 60_000, 'setAutoSync crea el intervalo esperado');
    assert(typeof cleanupAutoSync === 'function', 'el motor expone cleanupAutoSync');
    cleanupAutoSync();
    assert(clearCount === 1, 'cleanupAutoSync cancela el intervalo activo');
    cleanupAutoSync();
    assert(clearCount === 1, 'cleanupAutoSync es idempotente');

  assert(
    resolveNotasForSync({ isNewRow: true, existingNotas: '', sgio: '' }) === 'NUEVO (sin SGIO)',
    'fila nueva sin SGIO debe marcarse NUEVO (sin SGIO)',
  );
  assert(
    resolveNotasForSync({ isNewRow: true, existingNotas: '', sgio: '69656525' }) === '',
    'fila nueva con SGIO no debe forzar NOTAS',
  );
  assert(
    resolveNotasForSync({ isNewRow: false, existingNotas: 'Duplicado', sgio: '' }) === 'Duplicado',
    'fila existente debe conservar NOTAS',
  );

  const bdRows = [
    ['NIS', 'SGIO', 'DESTINO'],
    ['4210801', '69656525', 'DVD 03'],
    ['4210802', '', 'DVD 03'],
    ['4210803', '69656527', 'DVD 03'],
  ];
  assert(countSinSgioRows(bdRows) === 1, 'countSinSgioRows cuenta filas sin SGIO');

  const existing = new Set(['4210801', '4210999']);
  assert(
    countScanSinSgio(['4210801', '4210802', '4210803'], existing) === 2,
    'countScanSinSgio cuenta NIS del scan ausentes en BD_IMG',
  );

  const folderRows = [
    ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'],
    ['JUAN', 'abc123folder', '✅', '2026-07-03', '12'],
    ['PEDRO', 'def456folder', '❌', '', '0'],
  ];
  const folders = parseFoldersFromValues(folderRows);
  assert(folders.length === 2 && folders[0].activo && !folders[1].activo, 'parseFoldersFromValues parsea carpetas');

  const metrics = parseResumenMetrics([
    ['METRICA', 'VALOR', 'FECHA'],
    ['TOTAL NIS', '42', '2026-07-03'],
    ['🟢 COMPLETOS (3/3)', '10', '2026-07-03'],
  ]);
  const metricsWithSinSgio = parseResumenMetrics([
    ['METRICA', 'VALOR', 'FECHA'],
    ['TOTAL NIS', '42', '2026-07-03'],
    ['SIN SGIO', '7', '2026-07-03'],
  ]);
  assert(metricsWithSinSgio.totalNis === 42 && metricsWithSinSgio.sinSgio === 7, 'parseResumenMetrics extrae sinSgio');
  assert(metrics.totalNis === 42 && metrics.completos === 10, 'parseResumenMetrics extrae métricas');

  const configRows = [['Clave', 'Valor'], ['ULTIMO_SYNC', '2026-07-03 10:00:00']];
  assert(configValueFromRows(configRows, 'ULTIMO_SYNC') === '2026-07-03 10:00:00', 'configValueFromRows lee CONFIG');

  const parsed = parseArrastreRows([
    ['NIS', 'SGIO', 'MOTIVO', 'FECHA', 'OBSERVACION'],
    ['4210801', '69656525', 'Arrastre manual', '2026-07-01', 'Reasignado'],
  ]);
  assert(parsed.length === 1 && parsed[0].nis === '4210801', 'parseArrastreRows parsea filas');

  const rows = [
    ['NIS', 'SGIO', 'DESTINO', 'NOMBRE', 'DIR', 'IMG_1', 'IMG_2', 'IMG_3', 'CANT', 'ESTADO', 'ORIGEN', 'VERIF', 'NOTAS'],
    ['4210999', '11111111', 'DVD', 'X', '', '', '', '', '', '', '', '', ''],
  ];
  const built = buildScanResultRow({
    scanResult: { nis: '4210802', count: 2, folders: ['JUAN'] },
    rows,
    verification: '2026-07-03',
  });
  assert(built[0] === '4210802' && built[12] === 'NUEVO (sin SGIO)', 'buildScanResultRow marca NIS nuevo sin SGIO');

  const nisMap = buildNisRowIndexMap(rows);
  assert(nisMap.get('4210999') === 1, 'buildNisRowIndexMap indexa filas por NIS');
  const builtWithIndex = buildScanResultRow({
    scanResult: { nis: '4210999', count: 3, folders: ['JUAN'] },
    rows,
    verification: '2026-07-03',
    rowIndex: nisMap.get('4210999'),
  });
  assert(builtWithIndex[0] === '4210999' && builtWithIndex[1] === '11111111', 'buildScanResultRow usa rowIndex precalculado');

  const applied = applyScanResultsToRows(rows, [
    { nis: '4210802', count: 2, folders: ['JUAN'] }, // fuera del padrón → ignorado
    { nis: '4210999', count: 1, folders: ['JUAN'] }, // en padrón → actualiza
  ], '2026-07-03');
  assert(applied.newRows === 0, 'applyScanResultsToRows no inserta NIS fuera del padrón');
  assert(applied.updated === 1 && applied.matched === 1, 'applyScanResultsToRows solo actualiza NIS del padrón');
  assert(applied.unmatchedScan === 1, 'applyScanResultsToRows cuenta NIS de carpeta fuera del padrón');
  assert(applied.rows.length === 2, 'applyScanResultsToRows conserva solo header + filas del padrón');
  assert(applied.rows[1][0] === '4210999' && applied.rows[1][8] === '1', 'applyScanResultsToRows actualiza CANTIDAD del padrón');

  const drive = require('../electron/google-drive-service');
  const m1 = drive.buildNisMap(
    [{ name: '4210801-1.jpg', id: '1', modifiedTime: '' }],
    'JUAN',
  );
  const m2 = drive.buildNisMap(
    [{ name: '4210801-2.jpg', id: '2', modifiedTime: '' }],
    'PEDRO',
  );
  const merged = drive.mergeNisMaps([m1, m2]);
  assert(merged['4210801'].count === 2, 'mergeNisMaps suma imágenes entre carpetas');
  assert(merged['4210801'].folders.length === 2, 'mergeNisMaps acumula carpetas origen');

  const failed = buildFolderErrorSummary(
    { name: 'TECNICO JUAN', folder_id: 'abc123' },
    new Error('Folder ID inválido'),
  );
  assert(failed.count === 0 && failed.nis_found === 0, 'buildFolderErrorSummary resetea contadores');
  assert(failed.error === 'Folder ID inválido', 'buildFolderErrorSummary conserva mensaje');
  assert(
    formatFolderErrorScan('sin acceso') === 'ERROR: sin acceso',
    'formatFolderErrorScan agrega prefijo ERROR',
  );
  assert(
    formatFolderErrorScan('ERROR: ya marcado') === 'ERROR: ya marcado',
    'formatFolderErrorScan no duplica prefijo',
  );

  const mergedRows = [
    ['NIS', 'SGIO', 'DESTINO', 'NOMBRE', 'DIRECCION', 'IMG_1', 'IMG_2', 'IMG_3', 'CANTIDAD', 'ESTADO'],
    ['4210801', '1', '', '', '', '✅', '✅', '✅', '3', '🟢 COMPLETO'],
    ['4210802', '', '', '', '', '✅', '✅', '⬜', '2', '🔴 FALTANTE'],
    ['4210803', '3', '', '', '', '✅', '✅', '✅', '4', '🟡 SOBRANTE'],
  ];
  const fromRows = countBdImgEstadoMetrics(mergedRows);
  assert(fromRows.totalNis === 3, 'countBdImgEstadoMetrics cuenta TOTAL NIS desde BD_IMG');
  assert(fromRows.completos === 1 && fromRows.faltantes === 1 && fromRows.sobrantes === 1,
    'countBdImgEstadoMetrics deriva completos/faltantes/sobrantes desde CANTIDAD de todas las filas');

  const scanOnly = [{ nis: '4210802', count: 2, folders: ['JUAN'] }];
  const scanCompletos = scanOnly.filter((r) => r.count === 3).length;
  assert(scanCompletos !== fromRows.completos,
    'métricas solo-scan divergen de BD_IMG mergeado (regresión RESUMEN)');

    console.log('[PASS] AutoIMG sync-engine helpers OK.');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
