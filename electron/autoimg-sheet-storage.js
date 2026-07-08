const { readSecureJson, writeSecureJson, clearSecureJson, migratePlaintextJson } = require('./autoimg-secure-storage');
const { scopedFilename, scopedNamespace, getActiveUserKey } = require('./autoimg-user-scope');

function _paths() {
  return {
    file: scopedFilename('sheet.json'),
    ns: scopedNamespace('sheet'),
  };
}

function loadSheetConfig() {
  // Sin usuario activo: no devolver sheet de nadie
  if (!getActiveUserKey()) {
    return { sheet_id: '', name: '' };
  }
  const { file, ns } = _paths();
  const data = readSecureJson(file, ns);
  return {
    sheet_id: data?.sheet_id || '',
    name: data?.name || '',
  };
}

function saveSheetConfig(sheet_id, name = '') {
  if (!getActiveUserKey()) {
    // No guardar sheet sin usuario (evita archivo anonymous compartido)
    return;
  }
  const id = String(sheet_id || '').trim();
  if (id && !/^[a-zA-Z0-9_-]{10,128}$/.test(id)) {
    throw new Error('Sheet ID con formato inválido');
  }
  const { file, ns } = _paths();
  writeSecureJson(file, ns, {
    sheet_id: id,
    name: String(name || '').slice(0, 200),
  });
}

function clearSheetConfig() {
  if (!getActiveUserKey()) return;
  const { file } = _paths();
  clearSecureJson(file);
}

module.exports = { loadSheetConfig, saveSheetConfig, clearSheetConfig };
