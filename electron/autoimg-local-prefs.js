/**
 * Preferencias locales AutoIMG por usuario activo.
 * - Carpetas de escaneo (mirror de FOLDERS)
 * - Carpeta raíz de renombre DESTINO
 * No contiene tokens ni client_secret.
 */
const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');
const { scopedFilename, scopedNamespace, getActiveUserKey } = require('./autoimg-user-scope');

function _paths() {
  return {
    file: scopedFilename('local-prefs.json'),
    ns: scopedNamespace('local_prefs'),
  };
}

function _default() {
  return {
    folders: [],
    rename_dest_folder_id: '',
    rename_dest_name: '',
  };
}

function _sanitizeFolderId(id) {
  const s = String(id || '').trim();
  return /^[a-zA-Z0-9_-]{10,128}$/.test(s) ? s : '';
}

function loadLocalPrefs() {
  if (!getActiveUserKey()) return _default();
  const { file, ns } = _paths();
  const data = readSecureJson(file, ns);
  if (!data || typeof data !== 'object') return _default();
  return {
    folders: Array.isArray(data.folders) ? data.folders : [],
    rename_dest_folder_id: _sanitizeFolderId(data.rename_dest_folder_id),
    rename_dest_name: String(data.rename_dest_name || '').slice(0, 200),
  };
}

function saveLocalPrefs(partial) {
  if (!getActiveUserKey()) {
    return _default();
  }
  const current = loadLocalPrefs();
  const next = {
    ...current,
    ...(partial && typeof partial === 'object' ? partial : {}),
  };
  if (!Array.isArray(next.folders)) next.folders = current.folders;
  next.rename_dest_folder_id = _sanitizeFolderId(next.rename_dest_folder_id);
  next.rename_dest_name = String(next.rename_dest_name || '').slice(0, 200);
  const { file, ns } = _paths();
  writeSecureJson(file, ns, next);
  return next;
}

function saveLocalFolders(folders) {
  const list = (folders || [])
    .map((f) => ({
      name: String(f.name || '').slice(0, 200),
      folder_id: _sanitizeFolderId(f.folder_id),
      activo: f.activo !== false,
      ultimo_scan: String(f.ultimo_scan || '').slice(0, 64),
      cant_archivos: Number(f.cant_archivos) || 0,
    }))
    .filter((f) => f.folder_id);
  return saveLocalPrefs({ folders: list });
}

function loadLocalFolders() {
  return loadLocalPrefs().folders;
}

function saveRenameDest(folderId, name = '') {
  return saveLocalPrefs({
    rename_dest_folder_id: _sanitizeFolderId(folderId),
    rename_dest_name: String(name || '').slice(0, 200),
  });
}

function loadRenameDest() {
  const p = loadLocalPrefs();
  return {
    folder_id: p.rename_dest_folder_id || '',
    name: p.rename_dest_name || '',
  };
}

function clearLocalPrefs() {
  if (!getActiveUserKey()) return;
  const { file } = _paths();
  clearSecureJson(file);
}

module.exports = {
  loadLocalPrefs,
  saveLocalPrefs,
  saveLocalFolders,
  loadLocalFolders,
  saveRenameDest,
  loadRenameDest,
  clearLocalPrefs,
};
