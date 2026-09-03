const crypto = require('crypto');
const { readSecureJson, writeSecureJson, clearSecureJson } = require('./autoimg-secure-storage');

const ACTIVE_FILE = 'autoimg/active-user.json';
const ACTIVE_NS = 'active_user';

let _activeUserKey = null;
let _activeEmail = null;
let _activeUserGeneration = 0;
const _activeUserChangeListeners = [];

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
    }
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

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

function getActiveUserSnapshot() {
  return {
    userKey: getActiveUserKey(),
    generation: _activeUserGeneration,
  };
}

function isActiveUserSnapshotCurrent(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const current = getActiveUserSnapshot();
  return current.userKey === snapshot.userKey && current.generation === snapshot.generation;
}

function setActiveUser(email) {
  const e = normalizeEmail(email);
  const key = userKeyFromEmail(e);
  if (!key) return null;

  const prev = _activeUserKey;
  _activeUserKey = key;
  _activeEmail = e;

  writeSecureJson(ACTIVE_FILE, ACTIVE_NS, {
    user_key: key,
    email: e,
    email_masked: maskEmail(e),
    updated_at: new Date().toISOString(),
  });

  if (prev !== key) {
    _activeUserGeneration += 1;
    _notifyActiveUserChange(prev, key);
    migrateLegacyIntoActiveUser();
  }
  return key;
}

function clearActiveUser() {
  const prev = _activeUserKey;
  _activeUserKey = null;
  _activeEmail = null;
  clearSecureJson(ACTIVE_FILE);
  if (prev !== null) _activeUserGeneration += 1;
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
  getActiveUserSnapshot,
  isActiveUserSnapshotCurrent,
  setActiveUser,
  clearActiveUser,
  onActiveUserChange,
  scopedFilename,
  scopedNamespace,
  migrateLegacyIntoActiveUser,
  getActiveUserPublic,
};
