const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const { getMainWindow } = require('./window-manager');
const { OperationCancelledError, mapWithConcurrency } = require('./autoimg-concurrency');
const { scanActiveFolders } = require('./autoimg-scan-folders');
const { buildNisMetaMap, buildRenameJobs, uniqueDestinos } = require('./autoimg-rename');
const {
  saveLocalFolders,
  loadLocalFolders,
  saveRenameDest,
  loadRenameDest,
} = require('./autoimg-local-prefs');
const {
  BD_IMG_HEADER,
  countSinSgioRows,
  countBdImgEstadoMetrics,
  countScanSinSgio,
  applyScanResultsToRows,
  parseArrastreRows,
  parseFoldersFromValues,
  parseResumenMetrics,
  configValueFromRows,
  countActiveFolders,
} = require('./autoimg-sheet-rows');

const ROWS_PER_RANGE = 50;
const RANGES_PER_API_BATCH = 50;
const CACHE_TTL_MS = 60_000;
const AUTO_SYNC_CONFIG_KEY = 'AUTO_SYNC';
const RENAME_DEST_CONFIG_KEY = 'RENAME_DEST_FOLDER_ID';
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;
const RENAME_COPY_CONCURRENCY_MIN = 2;
const RENAME_COPY_CONCURRENCY_MAX = 8;

let _autoSyncEnabled = false;
let _autoSyncTimer = null;
let _activeOperation = null;
let _cancelRequested = false;
const CANCELLABLE_OPERATIONS = new Set(['scan', 'scan_sync', 'sync_to', 'rename']);
let _lastScanResults = null;
let _cachedBdImg = [];
let _cachedLogs = [];
let _cachedBdArrastre = [];
let _cachedFolders = [];
let _cacheLoadedAt = 0;
/** Drive modifiedTime of the spreadsheet when cache was last filled from Sheets. */
let _cacheSheetRevision = null;
/** Raise on repeated 429s during rename copies; decay after clean batches. */
let _renameConcurrencyBias = 0;

function emit(method, params) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', method, params);
}

function _now() {
  return new Date().toLocaleString('es-PE', { hour12: false });
}

function _isCacheFresh() {
  return _cacheLoadedAt > 0 && Date.now() - _cacheLoadedAt < CACHE_TTL_MS;
}

function _touchCache() {
  _cacheLoadedAt = Date.now();
}

function _invalidateCache() {
  _cacheLoadedAt = 0;
  _cacheSheetRevision = null;
}

/**
 * Adaptive copy concurrency for Drive rename export.
 * Scales with job count; backs off when recent batches hit rate limits.
 * @param {number} jobCount
 * @returns {number}
 */
function resolveRenameCopyConcurrency(jobCount) {
  const n = Number(jobCount) || 0;
  let base = 3;
  if (n >= 40) base = 6;
  else if (n >= 15) base = 4;
  const bias = Math.max(0, Math.min(4, _renameConcurrencyBias));
  return Math.max(
    RENAME_COPY_CONCURRENCY_MIN,
    Math.min(RENAME_COPY_CONCURRENCY_MAX, base - bias),
  );
}

function _noteRenameRateLimit() {
  _renameConcurrencyBias = Math.min(4, _renameConcurrencyBias + 1);
}

function _noteRenameBatchClean() {
  _renameConcurrencyBias = Math.max(0, _renameConcurrencyBias - 1);
}

function _isRateLimitError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /429|rate limit|Rate limit/i.test(msg);
}

async function _readSheetRevision() {
  try {
    const sheetId = sheets.getSheetId?.();
    if (!sheetId || typeof drive.getFileMetadata !== 'function') return null;
    const meta = await drive.getFileMetadata(sheetId, 'modifiedTime,version');
    return meta?.modifiedTime || (meta?.version != null ? String(meta.version) : null);
  } catch {
    return null;
  }
}

/**
 * True when in-memory sheet data is present and Drive reports the same revision.
 * Allows skipping full Sheets reads after TTL expiry when nothing changed.
 */
async function _canServeUnchangedRevision() {
  if (!_cacheSheetRevision) return false;
  if (!_cachedBdImg.length && !_cachedFolders.length && !_cachedLogs.length) return false;
  const rev = await _readSheetRevision();
  return Boolean(rev && rev === _cacheSheetRevision);
}

async function _rememberSheetRevision(knownRev) {
  if (knownRev) {
    _cacheSheetRevision = knownRev;
    return;
  }
  const rev = await _readSheetRevision();
  if (rev) _cacheSheetRevision = rev;
}

function _parseAutoSyncConfig(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'si' || v === 'yes';
}

function _throwIfCancelled() {
  if (_cancelRequested) throw new OperationCancelledError();
}

async function _runLocked(operation, fn) {
  if (_activeOperation) {
    throw new Error(`Ya hay una operación en curso (${_activeOperation}). Espera a que termine.`);
  }
  _activeOperation = operation;
  _cancelRequested = false;
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OperationCancelledError || _cancelRequested) {
      emit('autoimg.operation.cancelled', { operation });
      throw new Error('Operación cancelada por el usuario');
    }
    throw err;
  } finally {
    _activeOperation = null;
    _cancelRequested = false;
  }
}

function cancelOperation() {
  if (!_activeOperation) return { success: false, reason: 'no_operation' };
  if (!CANCELLABLE_OPERATIONS.has(_activeOperation)) {
    return { success: false, reason: 'not_cancellable', operation: _activeOperation };
  }
  _cancelRequested = true;
  return { success: true, operation: _activeOperation };
}

function getOperationStatus() {
  return { active: _activeOperation, cancellable: CANCELLABLE_OPERATIONS.has(_activeOperation) };
}

function _applyAutoSyncTimer(enabled) {
  const next = Boolean(enabled);
  if (next === _autoSyncEnabled && (!next || _autoSyncTimer)) return;
  _autoSyncEnabled = next;
  if (_autoSyncTimer) {
    clearInterval(_autoSyncTimer);
    _autoSyncTimer = null;
  }
  if (!_autoSyncEnabled) return;
  _autoSyncTimer = setInterval(() => {
    if (_activeOperation) return;
    syncFromSheet().catch((err) => {
      emit('autoimg.error', { code: 'AUTO_SYNC', detail: err.message });
    });
  }, AUTO_SYNC_INTERVAL_MS);
}

function cleanupAutoSync() {
  _applyAutoSyncTimer(false);
}

function _restoreAutoSyncFromConfig(configRows) {
  const value = configValueFromRows(configRows, AUTO_SYNC_CONFIG_KEY);
  if (!value) return;
  _applyAutoSyncTimer(_parseAutoSyncConfig(value));
}

function _statusFieldsFromBatch(batch, sheetConfig) {
  const configRows = batch['CONFIG!A:B'] || [];
  const resumenRows = batch['RESUMEN!A:C'] || [];
  const folderRows = batch['FOLDERS!A:E'] || [];
  const metrics = parseResumenMetrics(resumenRows);
  const folders = parseFoldersFromValues(folderRows);
  return {
    sheetName: sheetConfig.name || undefined,
    sheetId: sheetConfig.sheet_id || undefined,
    sheetLinked: sheetConfig.linked,
    lastSync: configValueFromRows(configRows, 'ULTIMO_SYNC') || undefined,
    totalNis: metrics.totalNis,
    completos: metrics.completos,
    faltantes: metrics.faltantes,
    sobrantes: metrics.sobrantes,
    sinSgio: metrics.sinSgio,
    carpetasActivas: folders.filter((f) => f.activo).length,
    folders,
  };
}

async function _readConfigValue(key) {
  try {
    const batch = await sheets.readRanges(['CONFIG!A:B']);
    return configValueFromRows(batch['CONFIG!A:B'], key);
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
  // Fallbacks: CONFIG sheet (if another path left it) then local secure storage
  let sheetId = '';
  try {
    sheetId = await _readConfigValue('SHEET_ID');
  } catch { /* not linked yet */ }
  if (!sheetId) {
    const stored = sheets.getStoredSheetConfig?.() || {};
    sheetId = stored.sheet_id || '';
  }
  if (sheetId) {
    await sheets.openSpreadsheet(sheetId);
    // Mirror into CONFIG for sheet-level portability
    try {
      await _upsertConfigValues({ SHEET_ID: sheetId });
    } catch { /* optional */ }
    return sheetId;
  }
  throw new Error('No hay Sheet configurado. Abre un Sheet con su ID primero.');
}

function _persistFoldersLocal(folders) {
  try {
    saveLocalFolders(folders);
  } catch { /* disk full / permissions — non-fatal */ }
}

async function listFolders({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { folders: _cachedFolders, cached: true };
  }
  if (!force && _cachedFolders.length && await _canServeUnchangedRevision()) {
    _touchCache();
    return { folders: _cachedFolders, cached: true, revision_match: true };
  }
  try {
    await _ensureSheetId();
    const rev = await _readSheetRevision();
    const { values } = await sheets.readRange('FOLDERS!A:E');
    _cachedFolders = parseFoldersFromValues(values);
    _persistFoldersLocal(_cachedFolders);
    _touchCache();
    await _rememberSheetRevision(rev);
    return { folders: _cachedFolders, cached: false };
  } catch (err) {
    // Offline / unauthenticated: serve last known local mirror so IDs are not "lost"
    const local = loadLocalFolders();
    if (local.length) {
      _cachedFolders = local;
      return { folders: local, cached: true, offline: true };
    }
    throw err;
  }
}

async function addFolder({ name, folder_id, activo }) {
  await _ensureSheetId();
  const verified = await drive.assertDriveFolder(folder_id);
  const safeFolderId = verified.folder_id;
  const folderName = name || verified.name || safeFolderId;

  // Avoid duplicate rows for the same folder_id
  const { values } = await sheets.readRange('FOLDERS!A:E');
  const rows = values.length ? [...values] : [['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS']];
  let found = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim() === safeFolderId) {
      rows[i][0] = folderName;
      rows[i][2] = activo ? '✅' : '❌';
      found = true;
      break;
    }
  }
  if (!found) {
    rows.push([folderName, safeFolderId, activo ? '✅' : '❌', '', 0]);
  }
  await sheets.writeRange('FOLDERS!A:E', rows);
  _cachedFolders = parseFoldersFromValues(rows);
  _persistFoldersLocal(_cachedFolders);
  _invalidateCache();
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
  _cachedFolders = parseFoldersFromValues(filtered);
  _persistFoldersLocal(_cachedFolders);
  _invalidateCache();
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
  _cachedFolders = parseFoldersFromValues(values);
  _persistFoldersLocal(_cachedFolders);
  _invalidateCache();
  return { success: true };
}

async function _scanAllCore() {
  await _ensureSheetId();
  _throwIfCancelled();
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
    shouldCancel: _throwIfCancelled,
    buildFolderErrorSummary,
  });

  _throwIfCancelled();
  await _markFolderErrorsInSheet(folderSummary);

  const dedupStrategy = drive.parseDedupStrategy(await _readConfigValue('DEDUP_STRATEGY'));
  const merged = drive.mergeNisMaps(nisMaps, dedupStrategy);
  // Retain fields needed by sync / IPC summary / renameExport.
  // Keep slim Drive file stubs (id + name only) — buildRenameJobs needs them;
  // drop modifiedTime and other bulky metadata after merge.
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

async function scanAll() {
  return _runLocked('scan', () => _scanAllCore());
}

async function scanAndSync() {
  return _runLocked('scan_sync', async () => {
    const scanResult = await _scanAllCore();
    const syncResult = await _syncToSheetCore();
    // Do not IPC-clone full nis_results (UI only uses logs/updated/new_rows).
    return {
      success: syncResult.success,
      updated: syncResult.updated,
      new_rows: syncResult.new_rows,
      logs: syncResult.logs,
      scan: {
        summary: scanResult.summary,
        folders_failed: scanResult.folders_failed,
      },
      folder_errors: scanResult.folders_failed,
    };
  });
}

async function _applySheetBatch(batch) {
  if (Object.prototype.hasOwnProperty.call(batch, 'BD_IMG!A:M')) {
    _cachedBdImg = batch['BD_IMG!A:M'] || [];
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'LOGS!A:E')) {
    _cachedLogs = batch['LOGS!A:E'] || [];
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'BD_ARRASTRE!A:E')) {
    _cachedBdArrastre = parseArrastreRows(batch['BD_ARRASTRE!A:E'] || []);
  }
  if (Object.prototype.hasOwnProperty.call(batch, 'FOLDERS!A:E')) {
    _cachedFolders = parseFoldersFromValues(batch['FOLDERS!A:E'] || []);
    if (_cachedFolders.length) _persistFoldersLocal(_cachedFolders);
  }
  _touchCache();
}

async function _fetchSheetBatch(ranges) {
  await _ensureSheetId();
  return sheets.readRanges(ranges);
}

async function syncFromSheet() {
  return _runLocked('sync_from', async () => {
    await _ensureSheetId();
    const rev = await _readSheetRevision();
    if (
      rev
      && rev === _cacheSheetRevision
      && (_cachedBdImg.length || _cachedBdArrastre.length)
    ) {
      _touchCache();
      emit('autoimg.sync.from_complete', { rows: _cachedBdImg.length, cached: true });
      return {
        success: true,
        rows: _cachedBdImg,
        arrastre: _cachedBdArrastre,
        cached: true,
        revision_match: true,
      };
    }
    const batch = await _fetchSheetBatch(['BD_IMG!A:M', 'LOGS!A:E', 'BD_ARRASTRE!A:E']);
    await _applySheetBatch({
      'BD_IMG!A:M': batch['BD_IMG!A:M'],
      'LOGS!A:E': batch['LOGS!A:E'],
      'BD_ARRASTRE!A:E': batch['BD_ARRASTRE!A:E'],
    });
    await _rememberSheetRevision(rev);
    emit('autoimg.sync.from_complete', { rows: _cachedBdImg.length });
    return { success: true, rows: _cachedBdImg, arrastre: _cachedBdArrastre, cached: false };
  });
}

async function listLogs({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { values: _cachedLogs, cached: true };
  }
  if (!force && _cachedLogs.length && await _canServeUnchangedRevision()) {
    _touchCache();
    return { values: _cachedLogs, cached: true, revision_match: true };
  }
  await _ensureSheetId();
  const rev = await _readSheetRevision();
  const { values } = await sheets.readRange('LOGS!A:E');
  _cachedLogs = values || [];
  _touchCache();
  await _rememberSheetRevision(rev);
  return { values: _cachedLogs, cached: false };
}

async function listArrastre({ force = false } = {}) {
  if (!force && _isCacheFresh()) {
    return { entries: _cachedBdArrastre, cached: true };
  }
  if (!force && _cachedBdArrastre.length && await _canServeUnchangedRevision()) {
    _touchCache();
    return { entries: _cachedBdArrastre, cached: true, revision_match: true };
  }
  await _ensureSheetId();
  const rev = await _readSheetRevision();
  const { values } = await sheets.readRange('BD_ARRASTRE!A:E');
  _cachedBdArrastre = parseArrastreRows(values || []);
  _touchCache();
  await _rememberSheetRevision(rev);
  return { entries: _cachedBdArrastre, cached: false };
}

async function _syncToSheetCore() {
  await _ensureSheetId();
  const start = Date.now();

  if (!_lastScanResults) {
    await _scanAllCore();
  }

  const { values: bdValues } = await sheets.readRange('BD_IMG!A:M');
  const verification = _now();
  const { rows, updated, newRows, matched, notFound, unmatchedScan } = applyScanResultsToRows(
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

  for (let i = 0; i < updates.length; i += RANGES_PER_API_BATCH) {
    _throwIfCancelled();
    const batch = updates.slice(i, i + RANGES_PER_API_BATCH);
    await sheets.batchWriteRanges(batch);
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
  // El padrón (BD_IMG) manda: no se agregan NIS del escaneo. Log informativo.
  const detail = [
    `${_lastScanResults.folder_summary.length} carpetas`,
    `${_lastScanResults.nis_results.length} NIS en carpetas`,
    `${matched ?? updated} del padrón actualizados`,
    `${notFound || 0} del padrón sin imágenes`,
    `${unmatchedScan || 0} fuera del padrón (ignorados)`,
  ].join(' · ');
  await sheets.appendRow('LOGS!A:E', [_now(), 'SCAN_ALL_FOLDERS', detail, auth.email || '', durationSec]);

  const activeFolderCount = countActiveFolders(fValues);
  const { totalNis, completos, faltantes, sobrantes } = countBdImgEstadoMetrics(rows);
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
  _invalidateCache();
  return { success: true, updated, new_rows: newRows, logs: [detail] };
}

async function syncToSheet() {
  return _runLocked('sync_to', () => _syncToSheetCore());
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
    _restoreAutoSyncFromConfig(batch['CONFIG!A:B'] || []);
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
    sinSgio: fields.sinSgio,
    carpetasActivas: fields.carpetasActivas,
  };
}

async function bootstrap({ refresh = true } = {}) {
  const auth = await sheets.getAuthStatus();
  const sheetConfig = sheets.getStoredSheetConfig();
  // Prefer in-memory cache; if empty, surface locally persisted folders
  const foldersForUi = _cachedFolders.length ? _cachedFolders : loadLocalFolders();
  const base = {
    connected: auth.authenticated,
    sheetName: sheetConfig.name || undefined,
    sheetId: sheetConfig.sheet_id || undefined,
    sheetLinked: sheetConfig.linked,
    autoSync: _autoSyncEnabled,
    folders: foldersForUi,
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

  if (!refresh && await _canServeUnchangedRevision()) {
    _touchCache();
    return {
      ...base,
      folders: _cachedFolders.length ? _cachedFolders : foldersForUi,
      bdRows: _cachedBdImg,
      logRows: _cachedLogs,
      arrastre: _cachedBdArrastre,
      cached: true,
      revision_match: true,
    };
  }

  try {
    await _ensureSheetId();
    const rev = await _readSheetRevision();
    const batch = await _fetchSheetBatch([
      'CONFIG!A:B',
      'RESUMEN!A:C',
      'FOLDERS!A:E',
      'BD_IMG!A:M',
      'LOGS!A:E',
      'BD_ARRASTRE!A:E',
    ]);
    await _applySheetBatch(batch);
    await _rememberSheetRevision(rev);
    const fields = _statusFieldsFromBatch(batch, sheets.getStoredSheetConfig());
    _restoreAutoSyncFromConfig(batch['CONFIG!A:B'] || []);
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
      sinSgio: fields.sinSgio,
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

async function setAutoSync(enabled) {
  const next = Boolean(enabled);
  _applyAutoSyncTimer(next);
  try {
    await _upsertConfigValues({ [AUTO_SYNC_CONFIG_KEY]: next ? 'true' : 'false' });
  } catch { /* CONFIG sheet may not exist yet */ }
  return { enabled: _autoSyncEnabled };
}

/**
 * Escanea carpetas activas, resuelve NIS→SGIO+DESTINO desde BD_IMG y copia
 * las imágenes a subcarpetas (por DESTINO) bajo un parent raíz, con nombre
 * {SGIO}_{n}.ext. El original no se mueve ni se borra.
 *
 * @param {string} dest_folder_id Parent raíz donde se crean carpetas DESTINO
 */
async function _renameExportCore({ dest_folder_id, only_completos = true } = {}) {
  await _ensureSheetId();
  _throwIfCancelled();

  const rootMeta = await drive.assertDriveFolder(dest_folder_id);
  const rootFolderId = rootMeta.folder_id;

  // A=NIS, B=SGIO, C=DESTINO
  const { values: bdValues } = await sheets.readRange('BD_IMG!A:C');
  const nisMeta = buildNisMetaMap(bdValues);

  // Re-scan to ensure file IDs + slots are fresh
  const scan = await _scanAllCore();
  _throwIfCancelled();

  const { jobs, skipped } = buildRenameJobs(scan.results.nis_results, nisMeta, {
    onlyCompletos: only_completos !== false,
  });

  // Pre-create / resolve DESTINO subfolders under root
  const destinoNames = uniqueDestinos(jobs);
  const destinoFolderIds = new Map();
  const foldersCreated = [];
  for (const name of destinoNames) {
    _throwIfCancelled();
    const sub = await drive.findOrCreateSubfolder(rootFolderId, name);
    destinoFolderIds.set(name, sub.folder_id);
    if (sub.created) foldersCreated.push(name);
    emit('autoimg.rename.folder', {
      name,
      folder_id: sub.folder_id,
      created: sub.created,
    });
  }

  emit('autoimg.rename.plan', {
    total_jobs: jobs.length,
    skipped: skipped.length,
    dest_folder_id: rootFolderId,
    dest_name: rootMeta.name,
    destinos: destinoNames.length,
    folders_created: foldersCreated.length,
  });

  const copied = [];
  const failed = [];
  let done = 0;
  const copyConcurrency = resolveRenameCopyConcurrency(jobs.length);
  let hitRateLimit = false;

  await mapWithConcurrency(
    jobs,
    copyConcurrency,
    async (job) => {
      _throwIfCancelled();
      const targetFolderId = destinoFolderIds.get(job.destino);
      try {
        if (!targetFolderId) {
          throw new Error(`Sin carpeta para DESTINO "${job.destino}"`);
        }
        const res = await drive.copyFileToFolder(job.fileId, targetFolderId, job.toName);
        copied.push({
          nis: job.nis,
          sgio: job.sgio,
          destino: job.destino,
          slot: job.slot,
          from: job.fromName,
          to: job.toName,
          folder: job.destino,
          file_id: res.id || '',
        });
      } catch (err) {
        if (_isRateLimitError(err)) hitRateLimit = true;
        failed.push({
          nis: job.nis,
          sgio: job.sgio,
          destino: job.destino,
          from: job.fromName,
          to: job.toName,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        done += 1;
        emit('autoimg.rename.progress', {
          current: done,
          total: jobs.length,
          last: `${job.destino}/${job.toName}`,
        });
      }
    },
    { shouldCancel: () => _cancelRequested },
  );

  if (hitRateLimit) _noteRenameRateLimit();
  else if (failed.length === 0 && jobs.length > 0) _noteRenameBatchClean();

  await _upsertConfigValues({ [RENAME_DEST_CONFIG_KEY]: rootFolderId });
  try {
    saveRenameDest(rootFolderId, rootMeta.name);
  } catch { /* local prefs best-effort */ }

  const detail =
    `Renombre SGIO → ${rootMeta.name}/{DESTINO}: ${copied.length} copiadas` +
    (foldersCreated.length ? `, ${foldersCreated.length} carpeta(s) nuevas` : '') +
    (failed.length ? `, ${failed.length} error(es)` : '') +
    (skipped.length ? `, ${skipped.length} omitida(s)` : '');

  try {
    await sheets.appendRow('LOGS!A:E', [_now(), 'RENAME_SGIO', detail, '', '']);
  } catch { /* LOGS optional */ }

  emit('autoimg.rename.complete', {
    copied: copied.length,
    failed: failed.length,
    skipped: skipped.length,
    dest_folder_id: rootFolderId,
    folders_created: foldersCreated.length,
  });

  return {
    success: failed.length === 0,
    dest_folder_id: rootFolderId,
    dest_name: rootMeta.name,
    destinos: destinoNames,
    folders_created: foldersCreated,
    copied,
    failed,
    skipped,
    planned: jobs.length,
    scan_summary: scan.summary,
  };
}

async function persistSheetIdConfig(sheetId) {
  const id = String(sheetId || '').trim();
  if (!id) return { success: false };
  await _upsertConfigValues({ SHEET_ID: id });
  return { success: true };
}

async function renameExport(params = {}) {
  // Persist root folder id immediately so a failed run still remembers the choice
  if (params?.dest_folder_id) {
    try {
      saveRenameDest(String(params.dest_folder_id), '');
    } catch { /* ignore */ }
  }
  return _runLocked('rename', () => _renameExportCore(params));
}

async function getRenameDestConfig() {
  let folderId = '';
  try {
    folderId = (await _readConfigValue(RENAME_DEST_CONFIG_KEY)) || '';
  } catch { /* sheet unavailable */ }
  const local = loadRenameDest();
  if (!folderId && local.folder_id) folderId = local.folder_id;
  // Keep local mirror in sync when sheet has the value
  if (folderId && folderId !== local.folder_id) {
    try {
      saveRenameDest(folderId, local.name || '');
    } catch { /* ignore */ }
  }
  return { folder_id: folderId, name: local.name || '' };
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
  renameExport,
  getRenameDestConfig,
  persistSheetIdConfig,
  getStatus,
  bootstrap,
  setAutoSync,
  cleanupAutoSync,
  cancelOperation,
  getOperationStatus,
  listArrastre,
  listLogs,
  buildFolderErrorSummary,
  formatFolderErrorScan,
  resolveRenameCopyConcurrency,
};