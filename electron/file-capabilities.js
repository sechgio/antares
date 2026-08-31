const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { assertPathNotSymlink } = require('./path-allowlist');
const { forEachReadLocation } = require('./file-token-contract');

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

/** Create a file capability for a local path. */
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
  return entry;
}

function revokeCapability(token) {
  _capabilities.delete(token);
}

/** Revoke staged capability and remove its temp file. */
async function cleanupStagedCapability(token, webContentsId = null) {
  const cap = _capabilities.get(token);
  if (!cap || !cap.staged || !cap.stagedSessionToken) return false;
  if (cap.webContentsId !== null && cap.webContentsId !== (webContentsId ?? null)) return false;
  await abortStagedSession(cap.stagedSessionToken);

  _capabilities.delete(token);
  return true;
}

function sweepExpired() {
  const now = _now();
  for (const [k, v] of _capabilities) {
    if (v.expiresAt <= now) _capabilities.delete(k);
  }
  for (const [k, v] of _stagedSessions) {
    if (v.expiresAt <= now) {
      if (v.readToken) _capabilities.delete(v.readToken);
      if (v.tmpPath) fsp.rm(v.tmpPath, { force: true }).catch(() => {});
      _stagedSessions.delete(k);
    }
  }
  try {
    const { sweepIpcTempDirs } = require('./ipc-temp-cleanup');
    void sweepIpcTempDirs(now);
  } catch {
    /* optional during early load */
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
  const tmpPath = path.join(root, `${token}_${safeName}`);
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

function _chunkToBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (typeof chunk === 'string') {
    // Legacy renderer path: base64 text.
    return Buffer.from(chunk, 'base64');
  }
  throw new Error('invalid chunk');
}

async function appendStagedChunk(token, chunk, webContentsId) {
  const session = _stagedSessions.get(token);
  if (!session) throw new Error('staged session not found');
  if (_isExpired(session)) { _stagedSessions.delete(token); throw new Error('staged session expired'); }
  if (session.webContentsId !== null && webContentsId !== null && session.webContentsId !== webContentsId) throw new Error('staged session window mismatch');
  if (session.completed) throw new Error('staged session already completed');
  const buf = _chunkToBuffer(chunk);
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
  const cap = createFileCapability({
    filePath: session.tmpPath,
    mode: 'read',
    webContentsId: session.webContentsId,
    name: session.name,
    size: stat.size,
  });
  cap.staged = true;
  cap.stagedSessionToken = token;
  session.completed = true;
  session.readToken = cap.token;
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

const WRITE_PATH_KEYS = new Set([
  'output_path',
  'outputPath',
  'output_dir',
  'outputDir',
  'output_folder',
  'outputFolder',
]);

function _isLogicalImageReference(value) {
  return value.startsWith('data:')
    || value.startsWith('blob:')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('canvas-asset:')
    || value.startsWith('antares-read_');
}

function _assertPathValue(value, label, { allowLogical = false, rejectAbsolute = true } = {}) {
  if (typeof value !== 'string') return;
  if (value.includes('\0')) throw new Error(`invalid path param: ${label}`);
  if (allowLogical && _isLogicalImageReference(value)) return;
  if (rejectAbsolute && path.isAbsolute(value)) {
    throw new Error(`raw absolute paths not allowed for ${label}; use file token`);
  }
  if (value.includes('..') && (value.includes('/') || value.includes('\\'))) {
    const norm = path.normalize(value);
    if (norm.includes('..')) throw new Error(`path traversal not allowed: ${label}`);
  }
}

function _assertNoRawAbsolutePaths(params, { pathIsWriteTarget = false } = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;

  // Inspect only fields declared by the IPC contract. Filenames inside
  // optimizer payloads and arbitrary metadata are not filesystem paths.
  forEachReadLocation(params, ({ kind, label, value }) => {
    if (pathIsWriteTarget && kind === 'scalar' && label === 'path') return;
    _assertPathValue(value, label, { allowLogical: kind === 'local-map' });
  });

  // Write paths remain raw by design, but still receive control-byte and
  // traversal validation before the write-policy resolver handles them.
  for (const key of WRITE_PATH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    _assertPathValue(params[key], key, { allowLogical: false, rejectAbsolute: false });
  }
  if (pathIsWriteTarget && Object.prototype.hasOwnProperty.call(params, 'path')) {
    _assertPathValue(params.path, 'path', { allowLogical: false, rejectAbsolute: false });
  }
}

module.exports = {
  createFileCapability,
  resolveCapability,
  revokeCapability,
  sweepExpired,
  createStagedSession,
  appendStagedChunk,
  _chunkToBuffer,
  completeStagedSession,
  abortStagedSession,
  cleanupStagedCapability,
  cleanupAllStaged,
  _assertNoRawAbsolutePaths,
};
