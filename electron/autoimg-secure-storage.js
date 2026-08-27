const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let app;
let safeStorage;
try {
  ({ app, safeStorage } = require('electron'));
} catch {
  app = undefined;
  safeStorage = undefined;
}

function _safeStorageAvailable() {
  try {
    return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function _deriveKey(namespace) {
  const appName = app && typeof app.getName === 'function' ? app.getName() : 'antares';
  const base = app && typeof app.getPath === 'function'
    ? app.getPath('userData')
    : path.join(os.tmpdir(), 'antares-autoimg');
  const seed = `${appName}:${base}:autoimg:${namespace}`;
  return crypto.createHash('sha256').update(seed).digest();
}

/** Legacy AES-GCM (v1). Used when Electron safeStorage is unavailable (tests/headless). */
function encryptPayloadAes(namespace, payload) {
  const iv = crypto.randomBytes(12);
  const key = _deriveKey(namespace);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptPayloadAes(namespace, encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = _deriveKey(namespace);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function encryptPayload(namespace, payload) {
  const json = JSON.stringify(payload);
  if (_safeStorageAvailable()) {
    const buf = safeStorage.encryptString(json);
    return { v: 2, data: Buffer.from(buf).toString('base64') };
  }
  return { v: 1, data: encryptPayloadAes(namespace, payload) };
}

function decryptPayload(namespace, encoded, version = 1) {
  if (version === 2) {
    if (!_safeStorageAvailable()) {
      throw new Error('safeStorage unavailable for v2 payload');
    }
    const plain = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    return JSON.parse(plain);
  }
  return decryptPayloadAes(namespace, encoded);
}

function userDataPath(filename) {
  const base = app && typeof app.getPath === 'function'
    ? app.getPath('userData')
    : path.join(os.tmpdir(), 'antares-autoimg');
  return path.join(base, filename);
}

function readSecureJson(filename, namespace) {
  const filePath = userDataPath(filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw?.data && typeof raw.data === 'string') {
      const version = Number(raw.v) === 2 ? 2 : 1;
      const payload = decryptPayload(namespace, raw.data, version);
      // Migrate legacy AES envelopes to OS-backed storage when available.
      if (version === 1 && _safeStorageAvailable()) {
        try {
          writeSecureJson(filename, namespace, payload);
        } catch {
          /* keep readable payload even if re-encrypt fails */
        }
      }
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSecureJson(filename, namespace, payload) {
  const filePath = userDataPath(filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sealed = encryptPayload(namespace, payload);
  const envelope = { v: sealed.v, data: sealed.data, savedAt: new Date().toISOString() };
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }
}

function clearSecureJson(filename) {
  const filePath = userDataPath(filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/** Migra un JSON legible en disco a formato cifrado y borra el secreto en claro. */
function migratePlaintextJson(filename, namespace, isPlaintext) {
  const filePath = userDataPath(filename);
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw?.data && typeof raw.data === 'string') return false;
    if (!isPlaintext(raw)) return false;
    writeSecureJson(filename, namespace, raw);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  readSecureJson,
  writeSecureJson,
  clearSecureJson,
  migratePlaintextJson,
  // AES helpers kept for unit tests that exercise the fallback path.
  encryptPayload: encryptPayloadAes,
  decryptPayload: decryptPayloadAes,
  _safeStorageAvailable,
};
