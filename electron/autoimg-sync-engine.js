const sheets = require('./google-sheets-service');
const { loadLocalFolders } = require('./autoimg-user-store');
const { onActiveUserChange } = require('./autoimg-user-scope');
const { sanitizeErrorMessage } = require('./autoimg-security');
const {
  SHEET_CACHE_BUDGET_BYTES,
  SHEET_CACHE_BLOCKS,
  sheetCache,
  isCacheFresh,
  touchCache,
  clearSheetCaches,
  tryCommitSheetCache,
  readSheetRevision,
  canServeUnchangedRevision,
  rememberSheetRevision,
  inspectSheetCache,
  setSheetCacheBudget,
  resetSheetCache,
} = require('./autoimg-sheet-cache');

const { emitError } = require('./autoimg-notify');
const {
  cancelOperation,
  getOperationStatus,
} = require('./autoimg-operations');
const {
  ensureSheetId,
  statusFieldsFromBatch,
  persistSheetIdConfig,
  getRenameDestConfig,
} = require('./autoimg-sheet-config');
const {
  buildFolderErrorSummary,
  formatFolderErrorScan,
  listFolders,
  addFolder,
  removeFolder,
  toggleFolder,
} = require('./autoimg-folders');
const {
  scanAll,
  scanAndSync,
  syncFromSheet,
  syncToSheet,
  listLogs,
  listArrastre,
  applySheetBatch,
  fetchSheetBatch,
  clearScanResults,
} = require('./autoimg-scan-sync');
const { renameExport, resolveRenameCopyConcurrency } = require('./autoimg-rename-export');
const { createAutoSync } = require('./autoimg-autosync');

const autoSync = createAutoSync({ tick: syncFromSheet });

function clearSessionCaches() {
  clearScanResults();
  clearSheetCaches();
}

onActiveUserChange(() => {
  clearSessionCaches();
});

function statusPayload(connected, fields, sheetConfig) {
  return {
    connected,
    sheetName: fields.sheetName || sheetConfig.name || undefined,
    sheetId: fields.sheetId || sheetConfig.sheet_id || undefined,
    sheetLinked: fields.sheetLinked ?? sheetConfig.linked,
    lastSync: fields.lastSync,
    autoSync: autoSync.isEnabled(),
    totalNis: fields.totalNis,
    completos: fields.completos,
    faltantes: fields.faltantes,
    sobrantes: fields.sobrantes,
    sinSgio: fields.sinSgio,
    carpetasActivas: fields.carpetasActivas,
  };
}

async function getStatus() {
  const auth = await sheets.getAuthStatus();
  const sheetConfig = sheets.getStoredSheetConfig();
  let fields = {};
  let refreshError = '';

  try {
    await ensureSheetId();
    const batch = await fetchSheetBatch(['CONFIG!A:B', 'RESUMEN!A:C', 'FOLDERS!A:E']);
    fields = statusFieldsFromBatch(batch, sheets.getStoredSheetConfig());
    const folders = fields.folders || [];
    const retained = tryCommitSheetCache({ folders });
    autoSync.restoreFromConfig(batch['CONFIG!A:B'] || []);
    if (retained) touchCache(['folders']);
  } catch (error) {
    refreshError = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    emitError('STATUS_REFRESH_FAILED', refreshError);
  }

  return {
    ...statusPayload(auth.authenticated, fields, sheetConfig),
    ...(refreshError ? { stale: true, error: refreshError, error_code: 'STATUS_REFRESH_FAILED' } : {}),
  };
}

async function bootstrap({ refresh = true } = {}) {
  const auth = await sheets.getAuthStatus();
  const sheetConfig = sheets.getStoredSheetConfig();
  const foldersForUi = sheetCache.folders.length ? sheetCache.folders : loadLocalFolders();
  const base = {
    connected: auth.authenticated,
    sheetName: sheetConfig.name || undefined,
    sheetId: sheetConfig.sheet_id || undefined,
    sheetLinked: sheetConfig.linked,
    autoSync: autoSync.isEnabled(),
    folders: foldersForUi,
    bdRows: sheetCache.bdImg,
    logRows: sheetCache.logs,
    arrastre: sheetCache.arrastre,
    cached: false,
  };

  if (!auth.authenticated) return base;

  const useCache = !refresh && isCacheFresh(SHEET_CACHE_BLOCKS);
  if (useCache) {
    return { ...base, cached: true };
  }

  if (!refresh && await canServeUnchangedRevision(SHEET_CACHE_BLOCKS)) {
    touchCache(SHEET_CACHE_BLOCKS);
    return {
      ...base,
      folders: sheetCache.folders.length ? sheetCache.folders : foldersForUi,
      bdRows: sheetCache.bdImg,
      logRows: sheetCache.logs,
      arrastre: sheetCache.arrastre,
      cached: true,
      revision_match: true,
    };
  }

  try {
    await ensureSheetId();
    const rev = await readSheetRevision();
    const batch = await fetchSheetBatch([
      'CONFIG!A:B',
      'RESUMEN!A:C',
      'FOLDERS!A:E',
      'BD_IMG!A:M',
      'LOGS!A:E',
      'BD_ARRASTRE!A:E',
    ]);
    const applied = await applySheetBatch(batch);
    if (applied.retained) await rememberSheetRevision(rev, SHEET_CACHE_BLOCKS);
    const fields = statusFieldsFromBatch(batch, sheets.getStoredSheetConfig());
    autoSync.restoreFromConfig(batch['CONFIG!A:B'] || []);
    return {
      ...statusPayload(true, fields, sheetConfig),
      folders: applied.folders,
      bdRows: applied.bdImg,
      logRows: applied.logs,
      arrastre: applied.arrastre,
      cached: false,
      ...(applied.retained ? {} : { cache_skipped: true }),
    };
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    emitError('BOOTSTRAP', message);
    return {
      ...base,
      error: message,
      error_code: 'BOOTSTRAP_FAILED',
      stale: true,
    };
  }
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
  setAutoSync: autoSync.setEnabled,
  cleanupAutoSync: autoSync.cleanup,
  cancelOperation,
  getOperationStatus,
  listArrastre,
  listLogs,
  buildFolderErrorSummary,
  formatFolderErrorScan,
  resolveRenameCopyConcurrency,
  clearSessionCaches,
  SHEET_CACHE_BUDGET_BYTES,
  __setSheetCacheBudgetForTests: setSheetCacheBudget,
  __inspectSheetCacheForTests: inspectSheetCache,
  __resetSheetCacheForTests: resetSheetCache,
};
