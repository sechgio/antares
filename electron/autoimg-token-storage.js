const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');
const { scopedFilename, scopedNamespace, getActiveUserKey } = require('./autoimg-user-scope');

function _paths() {
  return {
    file: scopedFilename('tokens.json'),
    ns: scopedNamespace('tokens'),
  };
}

function loadTokens() {
  // Solo el scope del usuario activo (o anonymous). Sin fallback a legacy
  // para no mezclar tokens entre cuentas.
  const { file, ns } = _paths();
  return readSecureJson(file, ns);
}

function saveTokens(tokens) {
  const safe = {
    access_token: tokens?.access_token,
    refresh_token: tokens?.refresh_token,
    expiry_date: tokens?.expiry_date,
  };
  const { file, ns } = _paths();
  writeSecureJson(file, ns, safe);
}

function clearTokens() {
  const { file } = _paths();
  clearSecureJson(file);
}

module.exports = { loadTokens, saveTokens, clearTokens };
