const { readSecureJson, writeSecureJson, clearSecureJson, migratePlaintextJson } = require('./autoimg-secure-storage');

const FILE = 'autoimg-sheet.json';
const NS = 'sheet';

function _migrateLegacy() {
  migratePlaintextJson(FILE, NS, (raw) => typeof raw.sheet_id === 'string');
}

function loadSheetConfig() {
  _migrateLegacy();
  const data = readSecureJson(FILE, NS);
  return {
    sheet_id: data?.sheet_id || '',
    name: data?.name || '',
  };
}

function saveSheetConfig(sheet_id, name = '') {
  writeSecureJson(FILE, NS, { sheet_id, name });
}

function clearSheetConfig() {
  clearSecureJson(FILE);
}

module.exports = { loadSheetConfig, saveSheetConfig, clearSheetConfig };