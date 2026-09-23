const sheets = require('./google-sheets-service');
const { emitError } = require('./autoimg-notify');
const { sanitizeErrorMessage } = require('./autoimg-security');
const { saveRenameDest, loadRenameDest } = require('./autoimg-user-store');
const {
  configValueFromRows,
  parseResumenMetrics,
  parseFoldersFromValues,
} = require('./autoimg-sheet-rows');

const AUTO_SYNC_CONFIG_KEY = 'AUTO_SYNC';
const RENAME_DEST_CONFIG_KEY = 'RENAME_DEST_FOLDER_ID';

function parseAutoSyncConfig(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'si' || v === 'yes';
}

async function readConfigValue(key) {
  try {
    const batch = await sheets.readRanges(['CONFIG!A:B']);
    return configValueFromRows(batch['CONFIG!A:B'], key);
  } catch {}
  return '';
}

async function upsertConfigValues(entries) {
  const updates = Object.entries(entries).filter(([, value]) => value != null && value !== '');
  if (!updates.length) return;
  const { values } = await sheets.readRange('CONFIG!A:B');
  const rows = values && values.length ? [...values] : [['Clave', 'Valor']];
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
}

async function tryUpsertConfigValues(entries) {
  try {
    await upsertConfigValues(entries);
    return { persisted: true };
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    emitError('CONFIG_WRITE_FAILED', message);
    return { persisted: false, error: message };
  }
}

async function ensureSheetId() {
  if (sheets.getSheetId()) return sheets.getSheetId();
  await sheets.restorePersistedSheet();
  if (sheets.getSheetId()) return sheets.getSheetId();
  let sheetId = '';
  try {
    sheetId = await readConfigValue('SHEET_ID');
  } catch {}
  if (!sheetId) {
    const stored = sheets.getStoredSheetConfig?.() || {};
    sheetId = stored.sheet_id || '';
  }
  if (sheetId) {
    await sheets.openSpreadsheet(sheetId);
    await tryUpsertConfigValues({ SHEET_ID: sheetId });
    return sheetId;
  }
  throw new Error('No hay Sheet configurado. Abre un Sheet con su ID primero.');
}

function statusFieldsFromBatch(batch, sheetConfig) {
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

async function persistSheetIdConfig(sheetId) {
  const id = String(sheetId || '').trim();
  if (!id) return { success: false, persisted: false, error: 'El ID del Sheet está vacío' };
  const persistence = await tryUpsertConfigValues({ SHEET_ID: id });
  return { success: persistence.persisted, ...persistence };
}

async function getRenameDestConfig() {
  let folderId = '';
  try {
    folderId = (await readConfigValue(RENAME_DEST_CONFIG_KEY)) || '';
  } catch {}
  const local = loadRenameDest();
  if (!folderId && local.folder_id) folderId = local.folder_id;
  if (folderId && folderId !== local.folder_id) {
    try {
      saveRenameDest(folderId, local.name || '');
    } catch {}
  }
  return { folder_id: folderId, name: local.name || '' };
}

module.exports = {
  AUTO_SYNC_CONFIG_KEY,
  RENAME_DEST_CONFIG_KEY,
  parseAutoSyncConfig,
  readConfigValue,
  tryUpsertConfigValues,
  ensureSheetId,
  statusFieldsFromBatch,
  persistSheetIdConfig,
  getRenameDestConfig,
};
