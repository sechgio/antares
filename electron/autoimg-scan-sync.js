const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const { appendLogEvent } = require('./app-log');
const { scanActiveFolders } = require('./autoimg-scan-folders');
const {
  BD_IMG_HEADER,
  countSinSgioRows,
  countBdImgEstadoMetrics,
  countScanFueraPadron,
  applyScanResultsToRows,
  parseArrastreRows,
  parseFoldersFromValues,
  countActiveFolders,
} = require('./autoimg-sheet-rows');
const {
  sheetCache,
  isCacheFresh,
  touchCache,
  invalidateCache,
  tryCommitSheetCache,
  readSheetRevision,
  canServeUnchangedRevision,
  rememberSheetRevision,
} = require('./autoimg-sheet-cache');
const { emit } = require('./autoimg-notify');
const { throwIfCancelled, runLocked } = require('./autoimg-operations');
const {
  readConfigValue,
  tryUpsertConfigValues,
  ensureSheetId,
} = require('./autoimg-sheet-config');
const {
  persistFoldersLocal,
  buildFolderErrorSummary,
  markFolderErrorsInSheet,
  applyFolderSummaryToSheetRows,
  listFolders,
} = require('./autoimg-folders');

const ROWS_PER_RANGE = 50;
const RANGES_PER_API_BATCH = 50;

let _lastScanResults = null;

function clearScanResults() {
  _lastScanResults = null;
}

function nowStamp() {
  return new Date().toLocaleString('es-PE', { hour12: false });
}

async function _loadExistingNisSet() {
  const existing = new Set();
  try {
    const { values } = await sheets.readRange('BD_IMG!A:A');
    for (let i = 1; i < values.length; i++) {
      const nis = String(values[i][0] || '').trim();
      if (nis) existing.add(nis);
    }
  } catch {}
  return existing;
}

async function scanAllCore() {
  await ensureSheetId();
  throwIfCancelled();
  const existingNis = await _loadExistingNisSet();
  const { folders } = await listFolders({ force: true });
  const active = folders.filter((f) => f.activo);

  const {
    folderSummary,
    nisMaps,
    totalFiles,
    foldersFailed,
  } = await scanActiveFolders(active, {
    drive,
    emit,
    shouldCancel: throwIfCancelled,
    buildFolderErrorSummary,
  });

  throwIfCancelled();
  await markFolderErrorsInSheet(folderSummary);

  const dedupStrategy = drive.parseDedupStrategy(await readConfigValue('DEDUP_STRATEGY'));
  const merged = drive.mergeNisMaps(nisMaps, dedupStrategy);
  const nisResults = Object.entries(merged).map(([nis, data]) => ({
    nis,
    count: data.count,
    folders: data.folders,
    estado: drive.computeEstado(data.count),
    files: (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      slot: f.slot,
    })),
  }));

  _lastScanResults = { folder_summary: folderSummary, nis_results: nisResults };

  appendLogEvent('INFO', 'autoimg.scan_all_done', {
    component: 'electron',
    outcome: 'success',
    count: totalFiles,
    message: `AutoIMG scan all done: ${active.length} folders, ${totalFiles} files`,
  });
  emit('autoimg.scan.all_done', {
    folders_scanned: active.length,
    folders_failed: foldersFailed,
    total_files: totalFiles,
    unique_nis: nisResults.length,
  });

  const completos = nisResults.filter((r) => r.count === 3).length;
  const faltantes = nisResults.filter((r) => r.count < 3).length;
  const sobrantes = nisResults.filter((r) => r.count > 3).length;
  const fuera_padron = countScanFueraPadron(nisResults.map((r) => r.nis), existingNis);

  return {
    results: _lastScanResults,
    summary: {
      total: nisResults.length,
      completos,
      faltantes,
      sobrantes,
      fuera_padron,
      sin_sgio: fuera_padron,
    },
    folders_failed: foldersFailed,
  };
}

async function scanAll() {
  return runLocked('scan', () => scanAllCore());
}

async function applySheetBatch(batch) {
  const partial = {};
  if (Object.prototype.hasOwnProperty.call(batch, 'BD_IMG!A:M')) {
    partial.bdImg = batch['BD_IMG!A:M'] || [];
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'LOGS!A:E')) {
    partial.logs = batch['LOGS!A:E'] || [];
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'BD_ARRASTRE!A:E')) {
    partial.arrastre = parseArrastreRows(batch['BD_ARRASTRE!A:E'] || []);
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'FOLDERS!A:E')) {
    partial.folders = parseFoldersFromValues(batch['FOLDERS!A:E'] || []);
  }

  const snapshot = {
    bdImg: Object.prototype.hasOwnProperty.call(partial, 'bdImg') ? partial.bdImg : sheetCache.bdImg,
    logs: Object.prototype.hasOwnProperty.call(partial, 'logs') ? partial.logs : sheetCache.logs,
    arrastre: Object.prototype.hasOwnProperty.call(partial, 'arrastre') ? partial.arrastre : sheetCache.arrastre,
    folders: Object.prototype.hasOwnProperty.call(partial, 'folders') ? partial.folders : sheetCache.folders,
  };

  const retained = tryCommitSheetCache(partial);
  if (retained) {
    if (Object.prototype.hasOwnProperty.call(partial, 'folders') && sheetCache.folders.length) {
      persistFoldersLocal(sheetCache.folders);
    }
    touchCache(Object.keys(partial));
  } else if (Object.prototype.hasOwnProperty.call(partial, 'folders') && snapshot.folders.length) {
    persistFoldersLocal(snapshot.folders);
  }
  return { retained, ...snapshot };
}

async function fetchSheetBatch(ranges) {
  await ensureSheetId();
  return sheets.readRanges(ranges);
}

async function syncFromSheet() {
  return runLocked('sync_from', async () => {
    await ensureSheetId();
    const rev = await readSheetRevision();
    if (await canServeUnchangedRevision(['bdImg', 'arrastre'], rev)) {
      touchCache(['bdImg', 'arrastre']);
      emit('autoimg.sync.from_complete', { rows: sheetCache.bdImg.length, cached: true });
      return {
        success: true,
        rows: sheetCache.bdImg,
        arrastre: sheetCache.arrastre,
        cached: true,
        revision_match: true,
      };
    }
    const batch = await fetchSheetBatch(['BD_IMG!A:M', 'LOGS!A:E', 'BD_ARRASTRE!A:E']);
    const applied = await applySheetBatch({
      'BD_IMG!A:M': batch['BD_IMG!A:M'],
      'LOGS!A:E': batch['LOGS!A:E'],
      'BD_ARRASTRE!A:E': batch['BD_ARRASTRE!A:E'],
    });
    if (applied.retained) await rememberSheetRevision(rev, ['bdImg', 'arrastre']);
    emit('autoimg.sync.from_complete', { rows: applied.bdImg.length });
    return {
      success: true,
      rows: applied.bdImg,
      arrastre: applied.arrastre,
      cached: false,
      ...(applied.retained ? {} : { cache_skipped: true }),
    };
  });
}

async function listLogs({ force = false } = {}) {
  if (!force && isCacheFresh(['logs'])) {
    return { values: sheetCache.logs, cached: true };
  }
  if (!force && await canServeUnchangedRevision(['logs'])) {
    touchCache(['logs']);
    return { values: sheetCache.logs, cached: true, revision_match: true };
  }
  await ensureSheetId();
  const rev = await readSheetRevision();
  const { values } = await sheets.readRange('LOGS!A:E');
  const nextLogs = values || [];
  const retained = tryCommitSheetCache({ logs: nextLogs });
  if (retained) {
    touchCache(['logs']);
    await rememberSheetRevision(rev, ['logs']);
    return { values: sheetCache.logs, cached: false };
  }
  return { values: nextLogs, cached: false, cache_skipped: true };
}

async function listArrastre({ force = false } = {}) {
  if (!force && isCacheFresh(['arrastre'])) {
    return { entries: sheetCache.arrastre, cached: true };
  }
  if (!force && await canServeUnchangedRevision(['arrastre'])) {
    touchCache(['arrastre']);
    return { entries: sheetCache.arrastre, cached: true, revision_match: true };
  }
  await ensureSheetId();
  const rev = await readSheetRevision();
  const { values } = await sheets.readRange('BD_ARRASTRE!A:E');
  const nextArrastre = parseArrastreRows(values || []);
  const retained = tryCommitSheetCache({ arrastre: nextArrastre });
  if (retained) {
    touchCache(['arrastre']);
    await rememberSheetRevision(rev, ['arrastre']);
    return { entries: sheetCache.arrastre, cached: false };
  }
  return { entries: nextArrastre, cached: false, cache_skipped: true };
}

async function _syncToSheetCore() {
  await ensureSheetId();
  const start = Date.now();

  if (!_lastScanResults) {
    await scanAllCore();
  }

  const { values: bdValues } = await sheets.readRange('BD_IMG!A:M');
  const verification = nowStamp();
  const { rows, updated, newRows, matched, notFound, unmatchedScan, duplicateNis } = applyScanResultsToRows(
    bdValues.length ? bdValues : [BD_IMG_HEADER],
    _lastScanResults.nis_results,
    verification,
  );
  const updates = [];

  for (let i = 0; i < rows.length; i += ROWS_PER_RANGE) {
    const chunk = rows.slice(i, i + ROWS_PER_RANGE);
    const startRow = i + 1;
    const endRow = startRow + chunk.length - 1;
    updates.push({ range: `BD_IMG!A${startRow}:M${endRow}`, values: chunk });
  }

  // Si la hoja tenía más filas que el resultado actual, limpiar el remanente:
  // filas viejas de NIS borrados reaparecerían en la próxima lectura.
  if (bdValues.length > rows.length) {
    const emptyTail = Array.from(
      { length: bdValues.length - rows.length },
      () => new Array(BD_IMG_HEADER.length).fill(''),
    );
    updates.push({ range: `BD_IMG!A${rows.length + 1}:M${bdValues.length}`, values: emptyTail });
  }

  let rangesWritten = 0;
  for (let i = 0; i < updates.length; i += RANGES_PER_API_BATCH) {
    throwIfCancelled({
      phase: 'bd_img_write',
      ranges_written: rangesWritten,
      ranges_total: updates.length,
      rows_total: rows.length,
    });
    const batch = updates.slice(i, i + RANGES_PER_API_BATCH);
    await sheets.batchWriteRanges(batch);
    rangesWritten += batch.length;
  }

  const folderRows = await sheets.readRange('FOLDERS!A:E');
  const fValues = folderRows.values || [];
  const folderTimestamp = nowStamp();
  for (const summary of _lastScanResults.folder_summary) {
    applyFolderSummaryToSheetRows(fValues, summary, folderTimestamp);
  }
  if (fValues.length) {
    throwIfCancelled({
      phase: 'folders_write',
      ranges_written: rangesWritten,
      ranges_total: updates.length,
      bd_img_complete: true,
    });
    await sheets.writeRange('FOLDERS!A:E', fValues);
  }

  const auth = await sheets.getAuthStatus();
  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  const detail = [
    `${_lastScanResults.folder_summary.length} carpetas`,
    `${_lastScanResults.nis_results.length} NIS en carpetas`,
    `${matched ?? updated} del padrón con match`,
    `${updated} filas cambiadas`,
    `${notFound || 0} del padrón sin imágenes`,
    `${unmatchedScan || 0} fuera del padrón (ignorados)`,
    ...(duplicateNis ? [`${duplicateNis} NIS duplicados en padrón`] : []),
  ].join(' · ');
  await sheets.appendRow('LOGS!A:E', [nowStamp(), 'SCAN_ALL_FOLDERS', detail, auth.email || '', durationSec]);

  const activeFolderCount = countActiveFolders(fValues);
  const { totalNis, completos, faltantes, sobrantes } = countBdImgEstadoMetrics(rows);
  const sinSgio = countSinSgioRows(rows);
  const timestamp = nowStamp();
  const resumen = [
    ['METRICA', 'VALOR', 'FECHA'],
    ['TOTAL NIS', String(totalNis), timestamp],
    ['🟢 COMPLETOS (3/3)', String(completos), timestamp],
    ['🔴 FALTANTES (<3)', String(faltantes), timestamp],
    ['🟡 SOBRANTES (>3)', String(sobrantes), timestamp],
    ['SIN SGIO', String(sinSgio), timestamp],
    ['CARPETAS ACTIVAS', String(activeFolderCount), timestamp],
    ['ULTIMO PROCESO', 'SCAN_ALL_FOLDERS', timestamp],
  ];
  await sheets.writeRange('RESUMEN!A:C', resumen);

  const syncTime = nowStamp();
  const sheetId = sheets.getSheetId();
  const configPersistence = await tryUpsertConfigValues({
    ULTIMO_SYNC: syncTime,
    ...(sheetId ? { SHEET_ID: sheetId } : {}),
    ...(auth.email ? { USUARIO: auth.email } : {}),
  });

  const folderErrors = (_lastScanResults.folder_summary || []).filter((s) => s.error).length;
  appendLogEvent('INFO', 'autoimg.sync_complete', {
    component: 'electron',
    outcome: 'success',
    count: updated,
    duration_ms: Date.now() - start,
    message: `AutoIMG sync complete: ${updated} updated, ${newRows} new`,
  });
  emit('autoimg.sync.complete', {
    updated,
    matched,
    unmatched_scan: unmatchedScan || 0,
    new: newRows,
    errors: folderErrors,
    duration_ms: Date.now() - start,
  });

  tryCommitSheetCache({ bdImg: rows });
  invalidateCache();
  return {
    success: true,
    updated,
    matched,
    unmatched_scan: unmatchedScan || 0,
    new_rows: newRows,
    duplicate_nis: duplicateNis || 0,
    logs: [detail],
    partial: !configPersistence.persisted,
    config_persisted: configPersistence.persisted,
    ...(configPersistence.error ? { warning: configPersistence.error } : {}),
  };
}

async function syncToSheet() {
  return runLocked('sync_to', () => _syncToSheetCore());
}

async function scanAndSync() {
  return runLocked('scan_sync', async () => {
    const scanResult = await scanAllCore();
    const syncResult = await _syncToSheetCore();
    return {
      success: syncResult.success,
      updated: syncResult.updated,
      matched: syncResult.matched,
      unmatched_scan: syncResult.unmatched_scan,
      new_rows: syncResult.new_rows,
      duplicate_nis: syncResult.duplicate_nis,
      logs: syncResult.logs,
      partial: syncResult.partial,
      config_persisted: syncResult.config_persisted,
      warning: syncResult.warning,
      scan: {
        summary: scanResult.summary,
        folders_failed: scanResult.folders_failed,
      },
      folder_errors: scanResult.folders_failed,
    };
  });
}

module.exports = {
  nowStamp,
  scanAllCore,
  scanAll,
  scanAndSync,
  applySheetBatch,
  fetchSheetBatch,
  syncFromSheet,
  syncToSheet,
  listLogs,
  listArrastre,
  clearScanResults,
};
