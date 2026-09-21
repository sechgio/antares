const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');
const { saveLocalFolders, loadLocalFolders } = require('./autoimg-user-store');
const { sanitizeErrorMessage } = require('./autoimg-security');
const { parseFoldersFromValues, AUTOIMG_SHEET_TABS } = require('./autoimg-sheet-rows');
const { ensureSheetId } = require('./autoimg-sheet-config');
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

function persistFoldersLocal(folders) {
  try {
    saveLocalFolders(folders);
  } catch {}
}

function buildFolderErrorSummary(folder, error) {
  const errMsg = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
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

async function markFolderErrorsInSheet(folderSummary) {
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
  } catch {}
}

function applyFolderSummaryToSheetRows(fValues, summary, timestamp) {
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

async function listFolders({ force = false } = {}) {
  if (!force && isCacheFresh(['folders'])) {
    return { folders: sheetCache.folders, cached: true };
  }
  if (!force && await canServeUnchangedRevision(['folders'])) {
    touchCache(['folders']);
    return { folders: sheetCache.folders, cached: true, revision_match: true };
  }
  try {
    await ensureSheetId();
    const rev = await readSheetRevision();
    const { values } = await sheets.readRange('FOLDERS!A:E');
    const folders = parseFoldersFromValues(values);
    persistFoldersLocal(folders);
    const retained = tryCommitSheetCache({ folders });
    if (retained) {
      touchCache(['folders']);
      await rememberSheetRevision(rev, ['folders']);
      return { folders: sheetCache.folders, cached: false };
    }
    return { folders, cached: false, cache_skipped: true };
  } catch (err) {
    const local = loadLocalFolders();
    if (local.length) {
      tryCommitSheetCache({ folders: local });
      return { folders: local, cached: true, offline: true };
    }
    throw err;
  }
}

async function addFolder({ name, folder_id, activo }) {
  await ensureSheetId();
  const verified = await drive.assertDriveFolder(folder_id);
  const safeFolderId = verified.folder_id;
  const folderName = name || verified.name || safeFolderId;

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
  const folders = parseFoldersFromValues(rows);
  persistFoldersLocal(folders);
  tryCommitSheetCache({ folders });
  invalidateCache();
  return { success: true, folder_id: safeFolderId, drive_name: verified.name, folders };
}

async function removeFolder({ folder_id }) {
  await ensureSheetId();
  const { values } = await sheets.readRange('FOLDERS!A:E');
  const filtered = [values[0] || ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS']];
  for (let i = 1; i < values.length; i++) {
    if (values[i][1] !== folder_id) filtered.push(values[i]);
  }
  await sheets.writeRange('FOLDERS!A:E', filtered);
  // values.update solo reemplaza las filas enviadas: sin limpiar el remanente,
  // la última carpeta queda duplicada en la hoja y reaparece al volver a leer.
  if (values.length > filtered.length) {
    const emptyTail = Array.from(
      { length: values.length - filtered.length },
      () => new Array(AUTOIMG_SHEET_TABS.FOLDERS.length).fill(''),
    );
    await sheets.writeRange(
      `FOLDERS!A${filtered.length + 1}:E${values.length}`,
      emptyTail,
    );
  }
  const folders = parseFoldersFromValues(filtered);
  persistFoldersLocal(folders);
  tryCommitSheetCache({ folders });
  invalidateCache();
  return { success: true, folders };
}

async function toggleFolder({ folder_id, activo }) {
  await ensureSheetId();
  const { values } = await sheets.readRange('FOLDERS!A:E');
  for (let i = 1; i < values.length; i++) {
    if (values[i][1] === folder_id) {
      values[i][2] = activo ? '✅' : '❌';
      break;
    }
  }
  await sheets.writeRange('FOLDERS!A:E', values);
  const folders = parseFoldersFromValues(values);
  persistFoldersLocal(folders);
  tryCommitSheetCache({ folders });
  invalidateCache();
  return { success: true, folders };
}

module.exports = {
  persistFoldersLocal,
  buildFolderErrorSummary,
  formatFolderErrorScan,
  markFolderErrorsInSheet,
  applyFolderSummaryToSheetRows,
  listFolders,
  addFolder,
  removeFolder,
  toggleFolder,
};
