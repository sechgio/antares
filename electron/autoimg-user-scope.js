/**
 * Scope de datos AutoIMG por usuario de Google.
 *
 * - Clave de carpeta: SHA-256 del email (nunca el email en el nombre de archivo).
 * - Datos por usuario en userData/autoimg/users/<key>/
 * - El Client ID OAuth de la app sigue siendo global (no es del usuario final).
 * - Al cerrar sesión se borra el puntero "activo", no el almacén del usuario.
 */
const crypto = require('crypto');
const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');

const ACTIVE_FILE = 'autoimg/active-user.json';
const ACTIVE_NS = 'active_user';

let _activeUserKey = null;
let _activeEmail = null;
/** @type {Array<(info: { previousKey: string|null, nextKey: string|null }) => void>} */
const _activeUserChangeListeners = [];

/**
 * Registra un callback al cambiar/cerrar el usuario activo (p.ej. limpiar caches en RAM).
 * @param {(info: { previousKey: string|null, nextKey: string|null }) => void} fn
 * @returns {() => void} unsubscribe
 */
function onActiveUserChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _activeUserChangeListeners.push(fn);
  return () => {
    const i = _activeUserChangeListeners.indexOf(fn);
    if (i >= 0) _activeUserChangeListeners.splice(i, 1);
  };
}

function _notifyActiveUserChange(previousKey, nextKey) {
  if (previousKey === nextKey) return;
  for (const fn of _activeUserChangeListeners.slice()) {
    try {
      fn({ previousKey, nextKey });
    } catch {
      /* listener failures must not break auth */
    }
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Hash estable y no reversible del email (para paths en disco). */
function userKeyFromEmail(email) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return null;
  return crypto.createHash('sha256').update(`antares:autoimg:user:${e}`).digest('hex').slice(0, 32);
}

function maskEmail(email) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return '';
  const [local, domain] = e.split('@');
  if (!local) return `…@${domain}`;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}…@${domain}`;
}

function getActiveUserKey() {
  if (_activeUserKey) return _activeUserKey;
  const data = readSecureJson(ACTIVE_FILE, ACTIVE_NS);
  if (data?.user_key && typeof data.user_key === 'string' && /^[a-f0-9]{16,64}$/i.test(data.user_key)) {
    _activeUserKey = data.user_key;
    _activeEmail = typeof data.email === 'string' ? normalizeEmail(data.email) : null;
    return _activeUserKey;
  }
  return null;
}

function getActiveEmail() {
  getActiveUserKey();
  return _activeEmail || null;
}

/**
 * Activa el scope del usuario. Debe llamarse tras OAuth con el email real.
 * Migra datos legacy globales (una sola vez) hacia el almacén del usuario.
 */
function setActiveUser(email) {
  const e = normalizeEmail(email);
  const key = userKeyFromEmail(e);
  if (!key) return null;

  const prev = _activeUserKey;
  _activeUserKey = key;
  _activeEmail = e;

  writeSecureJson(ACTIVE_FILE, ACTIVE_NS, {
    user_key: key,
    // Email cifrado dentro del blob; no va en el nombre de archivo.
    email: e,
    email_masked: maskEmail(e),
    updated_at: new Date().toISOString(),
  });

  if (prev !== key) {
    _notifyActiveUserChange(prev, key);
    migrateLegacyIntoActiveUser();
  }
  return key;
}

/** Cierra sesión activa sin borrar el almacén por-usuario. */
function clearActiveUser() {
  const prev = _activeUserKey;
  _activeUserKey = null;
  _activeEmail = null;
  clearSecureJson(ACTIVE_FILE);
  _notifyActiveUserChange(prev, null);
}

function scopedFilename(baseName) {
  const key = getActiveUserKey();
  const safe = String(baseName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!key) return `autoimg/anonymous/${safe}`;
  return `autoimg/users/${key}/${safe}`;
}

function scopedNamespace(baseNs) {
  const key = getActiveUserKey() || 'anonymous';
  return `${baseNs}:u:${key}`;
}

/**
 * Copia datos de rutas legacy (pre multi-usuario) al usuario activo
 * solo si el destino aún no tiene datos. Tras migrar, borra el legacy
 * para no reinyectarlo al siguiente usuario.
 */
function migrateLegacyIntoActiveUser() {
  const key = getActiveUserKey();
  if (!key) return;

  const pairs = [
    { legacy: 'autoimg-tokens.json', legacyNs: 'tokens', file: 'tokens.json', ns: 'tokens' },
    { legacy: 'autoimg-sheet.json', legacyNs: 'sheet', file: 'sheet.json', ns: 'sheet' },
    { legacy: 'autoimg-local-prefs.json', legacyNs: 'local_prefs', file: 'local-prefs.json', ns: 'local_prefs' },
  ];

  for (const p of pairs) {
    const destFile = scopedFilename(p.file);
    const destNs = scopedNamespace(p.ns);
    if (readSecureJson(destFile, destNs)) {
      // Destino ya tiene datos: elimina legacy residual para no contaminar a otros
      clearSecureJson(p.legacy);
      continue;
    }
    const legacy = readSecureJson(p.legacy, p.legacyNs);
    if (!legacy || typeof legacy !== 'object') continue;
    writeSecureJson(destFile, destNs, legacy);
    clearSecureJson(p.legacy);
  }
}

function getActiveUserPublic() {
  const key = getActiveUserKey();
  if (!key) return { active: false };
  return {
    active: true,
    user_key: key,
    email_masked: maskEmail(_activeEmail || ''),
  };
}

module.exports = {
  normalizeEmail,
  userKeyFromEmail,
  maskEmail,
  getActiveUserKey,
  getActiveEmail,
  setActiveUser,
  clearActiveUser,
  onActiveUserChange,
  scopedFilename,
  scopedNamespace,
  migrateLegacyIntoActiveUser,
  getActiveUserPublic,
};
