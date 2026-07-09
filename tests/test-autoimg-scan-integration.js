/**
 * Integración: concurrencia de escaneo, cancelación y applyScanResultsToRows.
 */

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { mapWithConcurrency, OperationCancelledError } = require('../electron/autoimg-concurrency');
  const { scanActiveFolders } = require('../electron/autoimg-scan-folders');
  const { applyScanResultsToRows, BD_IMG_HEADER } = require('../electron/autoimg-sheet-rows');
  const { buildFolderErrorSummary } = require('../electron/autoimg-sync-engine');

  let peakConcurrency = 0;
  let activeWorkers = 0;
  const ordered = await mapWithConcurrency([10, 20, 30, 40], 2, async (value) => {
    activeWorkers += 1;
    peakConcurrency = Math.max(peakConcurrency, activeWorkers);
    await sleep(20);
    activeWorkers -= 1;
    return value * 2;
  });
  assert(ordered.join(',') === '20,40,60,80', 'mapWithConcurrency preserva el orden');
  assert(peakConcurrency <= 2, 'mapWithConcurrency respeta el límite de concurrencia');

  let cancelled = false;
  let threw = false;
  try {
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      await sleep(5);
      return value;
    }, {
      shouldCancel: () => {
        cancelled = true;
        return true;
      },
    });
  } catch (err) {
    threw = err instanceof OperationCancelledError;
  }
  assert(cancelled && threw, 'mapWithConcurrency propaga cancelación');

  const emitted = [];
  const mockDrive = {
    buildNisMap: (files, folderName) => {
      const map = {};
      for (const file of files) {
        const match = file.name.match(/\b(\d{7})\b/);
        if (!match) continue;
        const nis = match[1];
        if (!map[nis]) map[nis] = { count: 0, files: [], folders: [] };
        map[nis].count += 1;
        map[nis].files.push(file.name);
        map[nis].folders.push(folderName);
      }
      return map;
    },
    listFolder: async (folderId) => {
      await sleep(15);
      if (folderId === 'fail-folder') throw new Error('sin acceso');
      return [
        { id: '1', name: `${folderId.slice(0, 7)}-1.jpg`, modifiedTime: '' },
        { id: '2', name: `${folderId.slice(0, 7)}-2.jpg`, modifiedTime: '' },
      ];
    },
  };

  const active = [
    { name: 'CARPETA_A', folder_id: '4210801001', activo: true },
    { name: 'CARPETA_B', folder_id: '4210802001', activo: true },
    { name: 'CARPETA_C', folder_id: 'fail-folder', activo: true },
  ];

  const scanResult = await scanActiveFolders(active, {
    drive: mockDrive,
    emit: (method, params) => emitted.push({ method, params }),
    buildFolderErrorSummary,
    concurrency: 2,
    shouldCancel: () => false,
  });

  assert(scanResult.folderSummary.length === 3, 'scanActiveFolders procesa todas las carpetas');
  assert(scanResult.nisMaps.length === 2, 'scanActiveFolders acumula mapas de carpetas exitosas');
  assert(scanResult.foldersFailed === 1, 'scanActiveFolders cuenta carpetas fallidas');
  assert(scanResult.totalFiles === 4, 'scanActiveFolders suma archivos escaneados');
  assert(
    emitted.some((e) => e.method === 'autoimg.scan.folder_start'),
    'scanActiveFolders emite folder_start',
  );

  const rows = [
    BD_IMG_HEADER,
    ['4210999', '11111111', 'DVD', 'X', '', '', '', '', '', '', '', '', ''],
    ['4210888', '22222222', 'DVD', 'Y', '', '', '', '', '', '', '', '', ''], // en padrón, sin imágenes en scan
  ];
  const applied = applyScanResultsToRows(rows, [
    { nis: '4210801', count: 2, folders: ['CARPETA_A'] }, // fuera del padrón → ignorado
    { nis: '4210999', count: 3, folders: ['CARPETA_B'] }, // en padrón → actualiza
  ], '2026-07-06');

  assert(applied.updated === 2, 'applyScanResultsToRows actualiza todas las filas del padrón');
  assert(applied.matched === 1, 'applyScanResultsToRows cuenta coincidencias con el escaneo');
  assert(applied.notFound === 1, 'applyScanResultsToRows marca filas del padrón sin imágenes');
  assert(applied.newRows === 0, 'applyScanResultsToRows no agrega filas nuevas desde el escaneo');
  assert(applied.unmatchedScan === 1, 'applyScanResultsToRows reporta NIS de carpeta fuera del padrón');
  assert(applied.rows.length === 3, 'applyScanResultsToRows conserva header + filas del padrón');
  assert(applied.rows[1][0] === '4210999' && applied.rows[1][8] === '3', 'actualiza CANTIDAD del NIS encontrado');
  assert(applied.rows[1][1] === '11111111', 'conserva SGIO del padrón');
  assert(applied.rows[2][0] === '4210888' && applied.rows[2][8] === '0', 'NIS del padrón sin imágenes queda en 0');
  assert(!applied.rows.some((r) => r[0] === '4210801'), 'no inserta NIS que no están en el padrón');

  const engine = require('../electron/autoimg-sync-engine');
  assert(engine.cancelOperation().success === false, 'cancelOperation sin operación activa devuelve false');
  const status = engine.getOperationStatus();
  assert(status.active === null && status.cancellable === false, 'getOperationStatus sin operación activa');

  console.log('[PASS] AutoIMG scan integration OK.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});