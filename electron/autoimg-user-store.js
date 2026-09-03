const { readSecureJson, writeSecureJson, clearSecureJson, migratePlaintextJson } = require('./autoimg-secure-storage');
const { scopedFilename, scopedNamespace, getActiveUserKey } = require('./autoimg-user-scope');

const OAUTH_CONFIG_FILE = 'autoimg-oauth-config.json';
const OAUTH_CONFIG_NS = 'oauth';

function _validateClientId(clientId) {
  if (!clientId) return;
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error(
      'Client ID inválido. Debe ser de tipo "Aplicación de escritorio" en Google Cloud y terminar en .apps.googleusercontent.com',
    );
  }
}

function loadOAuthConfigFromDisk() {
  migratePlaintextJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS, (raw) => (
    typeof raw.client_secret === 'string' || typeof raw.clientSecret === 'string'
  ));
  const cfg = readSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS);
  if (!cfg) return { clientId: '', clientSecret: '' };
  return {
    clientId: cfg.client_id || cfg.clientId || '',
    clientSecret: cfg.client_secret || cfg.clientSecret || '',
  };
}

function saveOAuthConfig(clientId, clientSecret) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || id.length < 12) throw new Error('Client ID inválido');
  _validateClientId(id);
  if (!secret || secret.length < 8) throw new Error('Client Secret inválido');
  writeSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS, { client_id: id, client_secret: secret });
  return { success: true };
}

function _tokenPaths() {
  return {
    file: scopedFilename('tokens.json'),
    ns: scopedNamespace('tokens'),
  };
}

function _tokenPathsForUserKey(userKey) {
  const key = userKey == null || userKey === '' ? 'anonymous' : String(userKey).trim();
  if (key === 'anonymous') {
    return { file: 'autoimg/anonymous/tokens.json', ns: 'tokens:u:anonymous' };
  }
  if (!/^[a-f0-9]{16,64}$/i.test(key)) return null;
  return {
    file: `autoimg/users/${key}/tokens.json`,
    ns: `tokens:u:${key}`,
  };
}

function _safeTokens(tokens) {
  return {
    access_token: tokens?.access_token,
    refresh_token: tokens?.refresh_token,
    expiry_date: tokens?.expiry_date,
  };
}

function loadTokens() {
  const { file, ns } = _tokenPaths();
  return readSecureJson(file, ns);
}

function saveTokens(tokens) {
  const safe = _safeTokens(tokens);
  const { file, ns } = _tokenPaths();
  writeSecureJson(file, ns, safe);
}

function clearTokens() {
  const { file } = _tokenPaths();
  clearSecureJson(file);
}

function loadTokensForUserKey(userKey) {
  const paths = _tokenPathsForUserKey(userKey);
  return paths ? readSecureJson(paths.file, paths.ns) : null;
}

function saveTokensForUserKey(userKey, tokens) {
  const paths = _tokenPathsForUserKey(userKey);
  if (paths) writeSecureJson(paths.file, paths.ns, _safeTokens(tokens));
}

function clearTokensForUserKey(userKey) {
  const paths = _tokenPathsForUserKey(userKey);
  if (paths) clearSecureJson(paths.file);
}

function clearTokensLegacyPaths() {
  clearSecureJson('autoimg/anonymous/tokens.json');
  clearSecureJson('autoimg-tokens.json');
}

function _sheetPaths() {
  return {
    file: scopedFilename('sheet.json'),
    ns: scopedNamespace('sheet'),
  };
}

function loadSheetConfig() {
  if (!getActiveUserKey()) {
    return { sheet_id: '', name: '' };
  }
  const { file, ns } = _sheetPaths();
  const data = readSecureJson(file, ns);
  return {
    sheet_id: data?.sheet_id || '',
    name: data?.name || '',
  };
}

function saveSheetConfig(sheet_id, name = '') {
  if (!getActiveUserKey()) {
    return;
  }
  const id = String(sheet_id || '').trim();
  if (id && !/^[a-zA-Z0-9_-]{10,128}$/.test(id)) {
    throw new Error('Sheet ID con formato inválido');
  }
  const { file, ns } = _sheetPaths();
  writeSecureJson(file, ns, {
    sheet_id: id,
    name: String(name || '').slice(0, 200),
  });
}

function clearSheetConfig() {
  if (!getActiveUserKey()) return;
  const { file } = _sheetPaths();
  clearSecureJson(file);
}

function _prefsPaths() {
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
  const { file, ns } = _prefsPaths();
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
  const { file, ns } = _prefsPaths();
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
  const { file } = _prefsPaths();
  clearSecureJson(file);
}

module.exports = {
  loadOAuthConfigFromDisk,
  saveOAuthConfig,
  loadTokens,
  saveTokens,
  clearTokens,
  loadTokensForUserKey,
  saveTokensForUserKey,
  clearTokensForUserKey,
  clearTokensLegacyPaths,
  loadSheetConfig,
  saveSheetConfig,
  clearSheetConfig,
  loadLocalPrefs,
  saveLocalPrefs,
  saveLocalFolders,
  loadLocalFolders,
  saveRenameDest,
  loadRenameDest,
  clearLocalPrefs,
};
