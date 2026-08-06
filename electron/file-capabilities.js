const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { assertPathNotSymlink, isPathInside } = require('./path-allowlist');

const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_STAGED_FILE_BYTES = 1024 * 1024 * 1024;
const STAGED_DIR_PREFIX = 'antares-staged-';

const _capabilities = new Map();
const _stagedSessions = new Map();
let _stagedRoot = null;
let _sweepTimer = null;

function _now() { return Date.now(); }

function _getStagedRoot() {
  if (_stagedRoot) return _stagedRoot;
  _stagedRoot = path.join(os.tmpdir(), `${STAGED_DIR_PREFIX}${process.pid}`);
  return _stagedRoot;
}

function _ensureSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => sweepExpired(), 5 * 60 * 1000);
  if (_sweepTimer.unref) _sweepTimer.unref();
}

function _cleanupSweep() {
  if (_sweepTimer) { clearInterval(_sweepTimer); _sweepTimer = null; }
}

function _newToken(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function _isExpired(entry) {
  return entry.expiresAt <= _now();
}

function createFileCapability({ filePath, mode, webContentsId, name, size }) {
  if (!filePath || typeof filePath !== 'string') throw new Error('filePath required');
  const resolved = path.resolve(filePath);
  assertPathNotSymlink(resolved);
  const stat = fs.lstatSync(resolved);
  if (mode === 'read' && !stat.isFile()) throw new Error('not a file');
  if (mode === 'write' && stat.isSymbolicLink()) throw new Error('symbolic links not allowed');
  const token = _newToken(mode === 'read' ? 'antares-read' : 'antares-write');
  const entry = {
    token,
    mode,
    path: resolved,
    name: name || path.basename(resolved),
    size: typeof size === 'number' ? size : stat.size,
    webContentsId: webContentsId ?? null,
    createdAt: _now(),
    expiresAt: _now() + TOKEN_TTL_MS,
  };
  _capabilities.set(token, entry);
  _ensureSweep();
  return entry;
}

function resolveCapability(token, expectedMode, webContentsId) {
  if (typeof token !== 'string' || !token) throw new Error('invalid token');
  const entry = _capabilities.get(token);
  if (!entry) throw new Error('capability not found or expired');
  if (_isExpired(entry)) { _capabilities.delete(token); throw new Error('capability expired'); }
  if (expectedMode && entry.mode !== expectedMode) throw new Error('capability mode mismatch');
  if (entry.webContentsId !== null && webContentsId !== null && entry.webContentsId !== webContentsId) {
    throw new Error('capability not bound to this window');
  }
  const real = fs.realpathSync(entry.path);
  if (real !== entry.path) throw new Error('path symlink escape detected');
  if (!isPathInside(path.dirname(entry.path), real) && real !== entry.path) throw new Error('path escape');
  return entry;
}

function revokeCapability(token) {
  _capabilities.delete(token);
}

function sweepExpired() {
  const now = _now();
  for (const [k, v] of _capabilities) {
    if (v.expiresAt <= now) _capabilities.delete(k);
  }
  for (const [k, v] of _stagedSessions) {
    if (v.expiresAt <= now) {
      _capabilities.delete(v.token);
      if (v.tmpPath) fsp.rm(v.tmpPath, { force: true }).catch(() => {});
      _stagedSessions.delete(k);
    }
  }
}

async function _ensureStagedRoot() {
  const root = _getStagedRoot();
  await fsp.mkdir(root, { recursive: true });
  return root;
}

function createStagedSession({ name, size, webContentsId }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('name required');
  const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'upload';
  if (typeof size === 'number' && size > MAX_STAGED_FILE_BYTES) throw new Error('staged file too large');
  const token = _newToken('antares-staged');
  const root = _getStagedRoot();
  const tmpPath = path.join(root, `${token}_${safeName}.tmp`);
  const session = {
    token,
    name: safeName,
    size: typeof size === 'number' ? size : null,
    tmpPath,
    bytesWritten: 0,
    webContentsId: webContentsId ?? null,
    createdAt: _now(),
    expiresAt: _now() + TOKEN_TTL_MS,
    completed: false,
  };
  _stagedSessions.set(token, session);
  _ensureSweep();
  return session;
}

async function appendStagedChunk(token, chunkBase64, webContentsId) {
  const session = _stagedSessions.get(token);
  if (!session) throw new Error('staged session not found');
  if (_isExpired(session)) { _stagedSessions.delete(token); throw new Error('staged session expired'); }
  if (session.webContentsId !== null && webContentsId !== null && session.webContentsId !== webContentsId) throw new Error('staged session window mismatch');
  if (session.completed) throw new Error('staged session already completed');
  const buf = Buffer.from(chunkBase64, 'base64');
  if (buf.length === 0) throw new Error('empty chunk');
  if (buf.length > MAX_CHUNK_BYTES) throw new Error('chunk too large');
  if (session.bytesWritten + buf.length > MAX_STAGED_FILE_BYTES) throw new Error('staged file exceeds 1 GiB');
  await _ensureStagedRoot();
  await fsp.appendFile(session.tmpPath, buf);
  session.bytesWritten += buf.length;
  session.expiresAt = _now() + TOKEN_TTL_MS;
  return { bytesWritten: session.bytesWritten };
}

async function completeStagedSession(token, webContentsId) {
  const session = _stagedSessions.get(token);
  if (!session) throw new Error('staged session not found');
  if (_isExpired(session)) { _stagedSessions.delete(token); throw new Error('staged session expired'); }
  if (session.webContentsId !== null && webContentsId !== null && session.webContentsId !== webContentsId) throw new Error('staged session window mismatch');
  if (session.completed) throw new Error('already completed');
  let stat;
  try { stat = await fsp.stat(session.tmpPath); } catch { throw new Error('staged file missing'); }
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > MAX_STAGED_FILE_BYTES) throw new Error('staged file too large');
  assertPathNotSymlink(session.tmpPath);
  const capToken = _newToken('antares-read');
  const cap = {
    token: capToken,
    mode: 'read',
    path: session.tmpPath,
    name: session.name,
    size: stat.size,
    webContentsId: session.webContentsId,
    createdAt: _now(),
    expiresAt: _now() + TOKEN_TTL_MS,
    staged: true,
    stagedSessionToken: token,
  };
  _capabilities.set(capToken, cap);
  session.completed = true;
  session.readToken = capToken;
  return cap;
}

async function abortStagedSession(token) {
  const session = _stagedSessions.get(token);
  if (!session) return;
  _stagedSessions.delete(token);
  if (session.readToken) _capabilities.delete(session.readToken);
  if (session.tmpPath) await fsp.rm(session.tmpPath, { force: true }).catch(() => {});
}

async function cleanupAllStaged() {
  _cleanupSweep();
  for (const [k, v] of _stagedSessions) {
    if (v.tmpPath) await fsp.rm(v.tmpPath, { force: true }).catch(() => {});
    if (v.readToken) _capabilities.delete(v.readToken);
  }
  _stagedSessions.clear();
  if (_stagedRoot) await fsp.rm(_stagedRoot, { recursive: true, force: true }).catch(() => {});
  for (const [k, v] of _capabilities) {
    if (v.staged && v.path && v.path.includes(STAGED_DIR_PREFIX)) {
      await fsp.rm(v.path, { force: true }).catch(() => {});
      _capabilities.delete(k);
    }
  }
}

function _assertNoRawAbsolutePaths(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;
  const suspiciousKeys = new Set(['path','file_path','filepath','output_path','outputPath','output_folder','outputFolder','excelPath','pdf_path','stamp_path']);
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string') continue;
    const lk = k.toLowerCase();
    const isPathKey = suspiciousKeys.has(k) || suspiciousKeys.has(lk) || lk.includes('path') || lk.includes('folder');
    if (!isPathKey) continue;
    if (v.includes('\0')) throw new Error(`invalid path param: ${k}`);
    if (path.isAbsolute(v)) throw new Error(`raw absolute paths not allowed for ${k}; use file token`);
    if (v.includes('..') && (v.includes('/') || v.includes('\\'))) {
      const norm = path.normalize(v);
      if (norm.includes('..')) throw new Error(`path traversal not allowed: ${k}`);
    }
  }
}

module.exports = {
  createFileCapability,
  resolveCapability,
  revokeCapability,
  sweepExpired,
  createStagedSession,
  appendStagedChunk,
  completeStagedSession,
  abortStagedSession,
  cleanupAllStaged,
  _assertNoRawAbsolutePaths,
  TOKEN_TTL_MS,
  MAX_CHUNK_BYTES,
  MAX_STAGED_FILE_BYTES,
  _capabilities,
  _stagedSessions,
};
