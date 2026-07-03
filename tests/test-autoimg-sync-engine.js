/**
 * Regresión: helpers de sync AutoIMG (NOTAS, sin_sgio, dedup ya cubierto en drive).
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function main() {
  const {
    buildFolderErrorSummary,
    formatFolderErrorScan,
    parseArrastreRows,
  } = require('../electron/autoimg-sync-engine');
  const {
    resolveNotasForSync,
    countSinSgioRows,
    countScanSinSgio,
    buildScanResultRow,
  } = require('../electron/autoimg-sheet-rows');

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

  console.log('[PASS] AutoIMG sync-engine helpers OK.');
}

main();