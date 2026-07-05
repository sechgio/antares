const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const { getMainWindow } = require('./window-manager');
const {
  BD_IMG_HEADER,
  resolveNotasForSync,
  countSinSgioRows,
  countScanSinSgio,
  findNisRowIndex,
  buildScanResultRow,
  parseArrastreRows,
} = require('./autoimg-sheet-rows');

const BATCH_SIZE = 10;
const CACHE_TTL_MS = 60_000;

let _autoSyncEnabled = false;
let _autoSyncTimer = null;
let _lastScanResults = null;
let _cachedBdImg = [];
let _cachedLogs = [];
let _cachedBdArrastre = [];
let _cachedFolders = [];
let _cacheLoadedAt = 0;

function emit(method, params) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', method, params);
}

function _now() {
  return new Date().toLocaleString('es-PE', { hour12: false });
}

function _parseActivo(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === '✅' || v === 'SI' || v === 'TRUE' || v === '1' || v === 'ACTIVO';
}

function _isCacheFresh() {
  return _cacheLoadedAt > 0 && Date.now() - _cacheLoadedAt < CACHE_TTL_MS;
}

function _touchCache() {
  _cacheLoadedAt = Date.now();
}

function _configValueFromRows(values, key) {
  for (let i = 1; i < (values || []).length; i++) {
    if (String(values[i][0] || '').trim().toUpperCase() === key.toUpperCase()) {
      return values[i][1] || '';
    }
  }
  return '';
}

function _parseResumenMetrics(values) {
  const metrics = {};
  for (const row of values || []) {
    const metricKey = String(row[0] || '');
    if (metricKey === 'TOTAL NIS') metrics.totalNis = Number(row[1]) || 0;
    if (metricKey.includes('COMPLETOS')) metrics.completos = Number(row[1]) || 0;
    if (metricKey.includes('FALTANTES')) metrics.faltantes = Number(row[1]) || 0;
    if (metricKey.includes('SOBRANTES')) metrics.sobrantes = Number(row[1]) || 0;
  }
  return metrics;
}

function _parseFoldersFromValues(values) {
  if (!values?.length) return [];
  const folders = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[1]) continue;
    folders.push({
      name: row[0] || '',
      folder_id: row[1] || '',
      activo: _parseActivo(row[2]),
      ultimo_scan: row[3] || '',
      cant_archivos: Number(row[4]) || 0,
    });
  }
  return folders;
}

function _statusFieldsFromBatch(batch, sheetConfig) {
  const configRows = batch['CONFIG!A:B'] || [];
  const resumenRows = batch['RESUMEN!A:C'] || [];
  const folderRows = batch['FOLDERS!A:E'] || [];
  const metrics = _parseResumenMetrics(resumenRows);
  const folders = _parseFoldersFromValues(folderRows);
  return {
    sheetName: sheetConfig.name || undefined,
    sheetId: sheetConfig.sheet_id || undefined,
    sheetLinked: sheetConfig.linked,
    lastSync: _configValueFromRows(configRows, 'ULTIMO_SYNC') || undefined,
    totalNis: metrics.totalNis,
    completos: metrics.completos,
    faltantes: metrics.faltantes,
    sobrantes: metrics.sobrantes,
    carpetasActivas: folders.filter((f) => f.activo).length,
    folders,
  };
}

async function _readConfigValue(key) {
  try {
    const batch = await sheets.readRanges(['CONFIG!A:B']);
    return _configValueFromRows(batch['CONFIG!A:B'], key);
  } catch { /* sheet may not exist yet */ }
  return '';
}

async function _upsertConfigValues(entries) {
  const updates = Object.entries(entries).filter(([, value]) => value != null && value !== '');
  if (!updates.length) return;
  try {
    const { values } = await sheets.readRange('CONFIG!A:B');
    const rows = values.length ? [...values] : [['Clave', 'Valor']];
    for (const [key, value] of updates) {
      let found = false;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim().toUpperCase() === key.toUpperCase()) {
          rows[i][1] = value;
          found = true;
          break;
        }
      }
      if (!found) rows.push([key, value]);
    }
    await sheets.writeRange('CONFIG!A:B', rows);
  } catch { /* CONFIG sheet may not exist yet */ }
}

async function _upsertConfigValue(key, value) {
  await _upsertConfigValues({ [key]: value });
}

function _countActiveFolders(fValues) {
  let count = 0;
  for (let i = 1; i < fValues.length; i++) {
    if (_parseActivo(fValues[i][2])) count += 1;
  }
  return count;
}

function buildFolderErrorSummary(folder, error) {
  const errMsg = error instanceof Error ? error.message : String(error);
  return {
    name: folder.name,
    folder_id: folder.folder_id,
    count: 0,
    nis_found: 0,
    error: errMsg,
  };
}

function formatFolderErrorScan(message) {
  const msg = String(message || '').trim();
  return msg.startsWith('ERROR:') ? msg : `ERROR: ${msg}`;
}

async function _markFolderErrorsInSheet(folderSummary) {
  const errors = folderSummary.filter((s) => s.error);
  if (!errors.length) return;
  try {
    const folderRows = await sheets.readRange('FOLDERS!A:E');
    const fValues = folderRows.values || [];
    for (const summary of errors) {
      for (let j = 1; j < fValues.length; j++) {
        if (fValues[j][1] === summary.folder_id) {
          fValues[j][3] = formatFolderErrorScan(summary.error);
          fValues[j][4] = '0';
        }
      }
    }
    if (fValues.length) await sheets.writeRange('FOLDERS!A:E', fValues);
  } catch { /* FOLDERS sheet may not exist yet */ }
}

function _applyFolderSummaryToSheetRows(fValues, summary, timestamp) {
  for (let j = 1; j < fValues.length; j++) {
    if (fValues[j][1] !== summary.folder_id) continue;
    if (summary.error) {
      fValues[j][3] = formatFolderErrorScan(summary.error);
      fValues[j][4] = '0';
    } else {
      fValues[j][3] = timestamp;
      fValues[j][4] = String(summary.count);
    }
    break;
  }
}

async function _loadExistingNisSet() {
  const existing = new Set();
  try {
    const { values } = await sheets.readRange('BD_IMG!A:A');
    for (let i = 1; i < values.length; i++) {
      const nis = String(values[i][0] || '').trim();
      if (nis) existing.add(nis);
    }
  } catch { /* BD_IMG may not exist yet */ }
  return existing;
}

async function _ensureSheetId() {
  if (sheets.getSheetId()) return sheets.getSheetId();
  await sheets.restorePersistedSheet();
  if (sheets.getSheetId()) return sheets.getSheetId();
  const sheetId = await _readConfigValue('SHEET_ID');
  if (sheetId) {
    await sheets.openSpreadsheet(sheetId);
    return sheetId;
  }
  throw new Error('No hay Sheet configurado. Abre un Sheet con su ID primero.');
}

async function listFolders({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { folders: _cachedFolders, cached: true };
  }
  await _ensureSheetId();
  const { values } = await sheets.readRange('FOLDERS!A:E');
  _cachedFolders = _parseFoldersFromValues(values);
  _touchCache();
  return { folders: _cachedFolders, cached: false };
}

async function addFolder({ name, folder_id, activo }) {
  await _ensureSheetId();
  const verified = await drive.assertDriveFolder(folder_id);
  const safeFolderId = verified.folder_id;
  await sheets.appendRow('FOLDERS!A:E', [
    name,
    safeFolderId,
    activo ? '✅' : '❌',
    '',
    0,
  ]);
  _cachedFolders = [];
  return { success: true, folder_id: safeFolderId, drive_name: verified.name };
}

async function removeFolder({ folder_id }) {
  await _ensureSheetId();
  const { values } = await sheets.readRange('FOLDERS!A:E');
  const filtered = [values[0] || ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS']];
  for (let i = 1; i < values.length; i++) {
    if (values[i][1] !== folder_id) filtered.push(values[i]);
  }
  await sheets.writeRange('FOLDERS!A:E', filtered);
  _cachedFolders = [];
  return { success: true };
}

async function toggleFolder({ folder_id, activo }) {
  await _ensureSheetId();
  const { values } = await sheets.readRange('FOLDERS!A:E');
  for (let i = 1; i < values.length; i++) {
    if (values[i][1] === folder_id) {
      values[i][2] = activo ? '✅' : '❌';
      break;
    }
  }
  await sheets.writeRange('FOLDERS!A:E', values);
  _cachedFolders = [];
  return { success: true };
}

async function scanAll() {
  await _ensureSheetId();
  const existingNis = await _loadExistingNisSet();
  const { folders } = await listFolders({ force: true });
  const active = folders.filter((f) => f.activo);
  const folderSummary = [];
  const nisMaps = [];
  let totalFiles = 0;
  let foldersFailed = 0;

  for (let i = 0; i < active.length; i++) {
    const folder = active[i];
    emit('autoimg.scan.folder_start', { folder: folder.name, index: i + 1, total: active.length });

    try {
      const files = await drive.listFolder(folder.folder_id);
      const nisMap = drive.buildNisMap(files, folder.name);

      for (let j = 0; j < files.length; j++) {
        emit('autoimg.scan.progress', {
          folder: folder.name,
          current: j + 1,
          total: files.length,
          file: files[j].name,
        });
      }

      const nisFound = Object.keys(nisMap).length;
      folderSummary.push({ name: folder.name, folder_id: folder.folder_id, count: files.length, nis_found: nisFound });
      emit('autoimg.scan.folder_done', { folder: folder.name, count: files.length, nis_found: nisFound });
      nisMaps.push(nisMap);
      totalFiles += files.length;
    } catch (err) {
      foldersFailed += 1;
      const failed = buildFolderErrorSummary(folder, err);
      folderSummary.push(failed);
      emit('autoimg.scan.folder_error', {
        folder: folder.name,
        error: failed.error,
        index: i + 1,
        total: active.length,
      });
      emit('autoimg.scan.folder_done', {
        folder: folder.name,
        count: 0,
        nis_found: 0,
        error: failed.error,
      });
    }
  }

  await _markFolderErrorsInSheet(folderSummary);

  const dedupStrategy = drive.parseDedupStrategy(await _readConfigValue('DEDUP_STRATEGY'));
  const merged = drive.mergeNisMaps(nisMaps, dedupStrategy);
  const nisResults = Object.entries(merged).map(([nis, data]) => ({
    nis,
    count: data.count,
    files: data.files,
    folders: data.folders,
    estado: drive.computeEstado(data.count),
  }));

  _lastScanResults = { folder_summary: folderSummary, nis_results: nisResults };

  emit('autoimg.scan.all_done', {
    folders_scanned: active.length,
    folders_failed: foldersFailed,
    total_files: totalFiles,
    unique_nis: nisResults.length,
  });

  const completos = nisResults.filter((r) => r.count === 3).length;
  const faltantes = nisResults.filter((r) => r.count < 3).length;
  const sobrantes = nisResults.filter((r) => r.count > 3).length;
  const sin_sgio = countScanSinSgio(nisResults.map((r) => r.nis), existingNis);

  return {
    results: _lastScanResults,
    summary: { total: nisResults.length, completos, faltantes, sobrantes, sin_sgio },
    folders_failed: foldersFailed,
  };
}

async function scanAndSync() {
  const scanResult = await scanAll();
  const syncResult = await syncToSheet();
  return {
    success: syncResult.success,
    updated: syncResult.updated,
    new_rows: syncResult.new_rows,
    logs: syncResult.logs,
    scan: scanResult,
    folder_errors: scanResult.folders_failed,
  };
}

async function _applySheetBatch(batch) {
  _cachedBdImg = batch['BD_IMG!A:M'] || [];
  _cachedLogs = batch['LOGS!A:E'] || [];
  _cachedBdArrastre = parseArrastreRows(batch['BD_ARRASTRE!A:E'] || []);
  _cachedFolders = _parseFoldersFromValues(batch['FOLDERS!A:E'] || []);
  _touchCache();
}

async function _fetchSheetBatch(ranges) {
  await _ensureSheetId();
  return sheets.readRanges(ranges);
}

async function syncFromSheet() {
  const batch = await _fetchSheetBatch(['BD_IMG!A:M', 'LOGS!A:E', 'BD_ARRASTRE!A:E']);
  await _applySheetBatch({
    'BD_IMG!A:M': batch['BD_IMG!A:M'],
    'LOGS!A:E': batch['LOGS!A:E'],
    'BD_ARRASTRE!A:E': batch['BD_ARRASTRE!A:E'],
  });
  return { success: true, rows: _cachedBdImg, arrastre: _cachedBdArrastre };
}

async function listLogs({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { values: _cachedLogs, cached: true };
  }
  await _ensureSheetId();
  const { values } = await sheets.readRange('LOGS!A:E');
  _cachedLogs = values || [];
  _touchCache();
  return { values: _cachedLogs, cached: false };
}

async function listArrastre({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { entries: _cachedBdArrastre, cached: true };
  }
  await _ensureSheetId();
  const { values } = await sheets.readRange('BD_ARRASTRE!A:E');
  _cachedBdArrastre = parseArrastreRows(values || []);
  _touchCache();
  return { entries: _cachedBdArrastre, cached: false };
}

async function syncToSheet() {
  await _ensureSheetId();
  const start = Date.now();

  if (!_lastScanResults) {
    await scanAll();
  }

  const { values: bdValues } = await sheets.readRange('BD_IMG!A:M');
  const rows = bdValues.length ? [...bdValues] : [BD_IMG_HEADER];

  let updated = 0;
  let newRows = 0;
  const updates = [];
  const verification = _now();

  for (const result of _lastScanResults.nis_results) {
    const idx = findNisRowIndex(rows, result.nis);
    const rowData = buildScanResultRow({ scanResult: result, rows, verification });

    if (idx > 0) {
      rows[idx] = rowData;
      updated += 1;
    } else {
      rows.push(rowData);
      newRows += 1;
    }
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const startRow = i + 1;
    const endRow = startRow + chunk.length - 1;
    updates.push({ range: `BD_IMG!A${startRow}:M${endRow}`, values: chunk });
  }

  let cellsUpdated = 0;
  for (let i = 0; i < updates.length; i += 1) {
    const batch = updates.slice(i, i + 1);
    const res = await sheets.batchWriteRanges(batch);
    cellsUpdated += res.updated;
  }

  const folderRows = await sheets.readRange('FOLDERS!A:E');
  const fValues = folderRows.values || [];
  const folderTimestamp = _now();
  for (const summary of _lastScanResults.folder_summary) {
    _applyFolderSummaryToSheetRows(fValues, summary, folderTimestamp);
  }
  if (fValues.length) await sheets.writeRange('FOLDERS!A:E', fValues);

  const auth = await sheets.getAuthStatus();
  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  const detail = `${_lastScanResults.folder_summary.length} carpetas · ${_lastScanResults.nis_results.length} NIS · ${updated} actualizados · ${newRows} nuevos`;
  await sheets.appendRow('LOGS!A:E', [_now(), 'SCAN_ALL_FOLDERS', detail, auth.email || '', durationSec]);

  const activeFolderCount = _countActiveFolders(fValues);
  const completos = _lastScanResults.nis_results.filter((r) => r.count === 3).length;
  const faltantes = _lastScanResults.nis_results.filter((r) => r.count < 3).length;
  const sobrantes = _lastScanResults.nis_results.filter((r) => r.count > 3).length;
  const totalNis = Math.max(0, rows.length - 1);
  const sinSgio = countSinSgioRows(rows);
  const timestamp = _now();
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

  const syncTime = _now();
  const sheetId = sheets.getSheetId();
  await _upsertConfigValues({
    ULTIMO_SYNC: syncTime,
    ...(sheetId ? { SHEET_ID: sheetId } : {}),
    ...(auth.email ? { USUARIO: auth.email } : {}),
  });

  const folderErrors = (_lastScanResults.folder_summary || []).filter((s) => s.error).length;
  emit('autoimg.sync.complete', { updated, new: newRows, errors: folderErrors, duration_ms: Date.now() - start });

  _cachedBdImg = rows;
  _cachedLogs = [];
  _touchCache();
  return { success: true, updated, new_rows: newRows, logs: [detail] };
}

async function getStatus() {
  const auth = await sheets.getAuthStatus();
  const sheetConfig = sheets.getStoredSheetConfig();
  let fields = {};

  try {
    await _ensureSheetId();
    const batch = await _fetchSheetBatch(['CONFIG!A:B', 'RESUMEN!A:C', 'FOLDERS!A:E']);
    fields = _statusFieldsFromBatch(batch, sheets.getStoredSheetConfig());
    _cachedFolders = fields.folders || [];
    _touchCache();
  } catch { /* sheet not configured yet */ }

  return {
    connected: auth.authenticated,
    sheetName: fields.sheetName || sheetConfig.name || undefined,
    sheetId: fields.sheetId || sheetConfig.sheet_id || undefined,
    sheetLinked: fields.sheetLinked ?? sheetConfig.linked,
    lastSync: fields.lastSync,
    autoSync: _autoSyncEnabled,
    totalNis: fields.totalNis,
    completos: fields.completos,
    faltantes: fields.faltantes,
    sobrantes: fields.sobrantes,
    carpetasActivas: fields.carpetasActivas,
  };
}

async function bootstrap({ refresh = true } = {}) {
  const auth = await sheets.getAuthStatus();
  const sheetConfig = sheets.getStoredSheetConfig();
  const base = {
    connected: auth.authenticated,
    sheetName: sheetConfig.name || undefined,
    sheetId: sheetConfig.sheet_id || undefined,
    sheetLinked: sheetConfig.linked,
    autoSync: _autoSyncEnabled,
    folders: _cachedFolders,
    bdRows: _cachedBdImg,
    logRows: _cachedLogs,
    arrastre: _cachedBdArrastre,
    cached: false,
  };

  if (!auth.authenticated) return base;

  const useCache = !refresh && _isCacheFresh();
  if (useCache) {
    return { ...base, cached: true };
  }

  try {
    await _ensureSheetId();
    const batch = await _fetchSheetBatch([
      'CONFIG!A:B',
      'RESUMEN!A:C',
      'FOLDERS!A:E',
      'BD_IMG!A:M',
      'LOGS!A:E',
      'BD_ARRASTRE!A:E',
    ]);
    await _applySheetBatch(batch);
    const fields = _statusFieldsFromBatch(batch, sheets.getStoredSheetConfig());
    return {
      connected: true,
      sheetName: fields.sheetName || sheetConfig.name || undefined,
      sheetId: fields.sheetId || sheetConfig.sheet_id || undefined,
      sheetLinked: fields.sheetLinked ?? sheetConfig.linked,
      lastSync: fields.lastSync,
      autoSync: _autoSyncEnabled,
      totalNis: fields.totalNis,
      completos: fields.completos,
      faltantes: fields.faltantes,
      sobrantes: fields.sobrantes,
      carpetasActivas: fields.carpetasActivas,
      folders: _cachedFolders,
      bdRows: _cachedBdImg,
      logRows: _cachedLogs,
      arrastre: _cachedBdArrastre,
      cached: false,
    };
  } catch {
    return base;
  }
}

function setAutoSync(enabled) {
  _autoSyncEnabled = Boolean(enabled);
  if (_autoSyncTimer) {
    clearInterval(_autoSyncTimer);
    _autoSyncTimer = null;
  }
  if (_autoSyncEnabled) {
    _autoSyncTimer = setInterval(() => {
      syncFromSheet().catch((err) => {
        emit('autoimg.error', { code: 'AUTO_SYNC', detail: err.message });
      });
    }, 5 * 60_000);
  }
  return { enabled: _autoSyncEnabled };
}

function getCachedBdImg() {
  return _cachedBdImg;
}

function getCachedLogs() {
  return _cachedLogs;
}

function getCachedBdArrastre() {
  return _cachedBdArrastre;
}

function getLastScanResults() {
  return _lastScanResults;
}

module.exports = {
  listFolders,
  addFolder,
  removeFolder,
  toggleFolder,
  scanAll,
  scanAndSync,
  syncToSheet,
  syncFromSheet,
  getStatus,
  bootstrap,
  setAutoSync,
  getCachedBdImg,
  getCachedLogs,
  getCachedBdArrastre,
  getLastScanResults,
  listArrastre,
  listLogs,
  resolveNotasForSync,
  countSinSgioRows,
  countScanSinSgio,
  buildFolderErrorSummary,
  formatFolderErrorScan,
  parseArrastreRows,
  parseFoldersFromValues: _parseFoldersFromValues,
  parseResumenMetrics: _parseResumenMetrics,
  configValueFromRows: _configValueFromRows,
};