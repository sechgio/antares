const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let app;
try {
  ({ app } = require('electron'));
} catch {
  app = undefined;
}

function _deriveKey(namespace) {
  const appName = app && typeof app.getName === 'function' ? app.getName() : 'antares';
  const base = app && typeof app.getPath === 'function'
    ? app.getPath('userData')
    : path.join(os.tmpdir(), 'antares-autoimg');
  const seed = `${appName}:${base}:autoimg:${namespace}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptPayload(namespace, payload) {
  const iv = crypto.randomBytes(12);
  const key = _deriveKey(namespace);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptPayload(namespace, encoded) {
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
      return decryptPayload(namespace, raw.data);
    }
    return null;
  } catch {
    return null;
  }
}

function writeSecureJson(filename, namespace, payload) {
  const filePath = userDataPath(filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const envelope = { v: 1, data: encryptPayload(namespace, payload), savedAt: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), { mode: 0o600 });
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
  encryptPayload,
  decryptPayload,
};