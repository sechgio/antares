/**
 * Lightweight local image thumbnails via Electron nativeImage.
 * Path A for conversion grid display — never touches Python preview_image.
 *
 * Optional on-disk cache keyed by path + mtime + maxEdge so revisiting a
 * folder across sessions avoids re-decoding via nativeImage.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { assertAllowedReadPath } = require('./path-allowlist');

const DEFAULT_MAX_EDGE = 256;
const MIN_MAX_EDGE = 32;
const MAX_MAX_EDGE = 1024;
const JPEG_QUALITY = 60;
const DISK_CACHE_MAX_FILES = 400;

let _cacheDir = null;

/**
 * @param {string} [dir]
 */
function setThumbnailCacheDir(dir) {
  _cacheDir = dir ? String(dir) : null;
}

function getThumbnailCacheDir() {
  if (_cacheDir) return _cacheDir;
  try {
    // Prefer Electron userData when available; fall back to OS temp in tests.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'thumb-cache');
    }
  } catch {
    /* not in Electron */
  }
  return path.join(os.tmpdir(), 'antares-thumb-cache');
}

/**
 * Validate and resolve an absolute local file path for thumbnail generation.
 * Rejects empty/relative/null-byte paths and non-files.
 * @param {unknown} filePath
 * @returns {string} resolved absolute path
 */
function assertSafeLocalPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('invalid path');
  }
  if (filePath.includes('\0')) {
    throw new Error('invalid path');
  }
  // Require absolute input before resolve so relative + cwd tricks are rejected.
  if (!path.isAbsolute(filePath)) {
    throw new Error('path must be absolute');
  }

  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved)) {
    throw new Error('path must be absolute');
  }

  // After resolve, reject any remaining ".." segment (defensive; resolve should
  // collapse them, but keep the guard for odd Windows/UNC edge cases).
  const parts = resolved.split(path.sep);
  if (parts.some((p) => p === '..')) {
    throw new Error('invalid path');
  }

  return assertAllowedReadPath(resolved);
}

function clampMaxEdge(maxEdge) {
  const n = typeof maxEdge === 'number' && Number.isFinite(maxEdge) ? Math.floor(maxEdge) : DEFAULT_MAX_EDGE;
  if (n < MIN_MAX_EDGE) return MIN_MAX_EDGE;
  if (n > MAX_MAX_EDGE) return MAX_MAX_EDGE;
  return n;
}

function _cacheKey(resolved, mtimeMs, edge) {
  return crypto
    .createHash('sha1')
    .update(`${resolved}|${mtimeMs}|${edge}`)
    .digest('hex');
}

function _readDiskCache(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const buf = fs.readFileSync(cachePath);
    if (!buf || !buf.length) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function _writeDiskCache(cacheDir, cachePath, jpegBuf) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, jpegBuf);
    fs.renameSync(tmp, cachePath);
    _trimDiskCache(cacheDir);
  } catch {
    /* disk full / permissions — non-fatal */
  }
}

function _trimDiskCache(cacheDir) {
  try {
    const entries = fs.readdirSync(cacheDir)
      .filter((name) => name.endsWith('.jpg'))
      .map((name) => {
        const full = path.join(cacheDir, name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return { full, mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const excess = entries.length - DISK_CACHE_MAX_FILES;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i += 1) {
      try {
        fs.unlinkSync(entries[i].full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} filePath absolute local path
 * @param {number} [maxEdge]
 * @param {import('electron').NativeImageConstructor | typeof import('electron').nativeImage} nativeImage
 * @returns {Promise<{ dataUrl: string }>}
 */
async function createLocalThumbnail(filePath, maxEdge, nativeImage) {
  if (!nativeImage) {
    throw new Error('nativeImage not available');
  }

  const resolved = assertSafeLocalPath(filePath);
  const edge = clampMaxEdge(maxEdge);

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(resolved).mtimeMs;
  } catch {
    throw new Error('unable to load image');
  }

  const cacheDir = getThumbnailCacheDir();
  const cachePath = path.join(cacheDir, `${_cacheKey(resolved, mtimeMs, edge)}.jpg`);
  const cached = _readDiskCache(cachePath);
  if (cached) return { dataUrl: cached };

  let image = null;

  // Prefer OS thumbnail API when present (macOS/Windows in modern Electron).
  if (typeof nativeImage.createThumbnailFromPath === 'function') {
    try {
      image = await nativeImage.createThumbnailFromPath(resolved, { width: edge, height: edge });
    } catch {
      image = null;
    }
  }

  if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
    image = nativeImage.createFromPath(resolved);
    if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
      throw new Error('unable to load image');
    }
    const size = typeof image.getSize === 'function' ? image.getSize() : null;
    if (size && size.width > 0 && size.height > 0) {
      const longest = Math.max(size.width, size.height);
      if (longest > edge) {
        const scale = edge / longest;
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good',
        });
      }
    }
  }

  // Prefer JPEG for smaller IPC payload; fall back to PNG data URL.
  if (typeof image.toJPEG === 'function') {
    const buf = image.toJPEG(JPEG_QUALITY);
    if (buf && buf.length) {
      const jpegBuf = Buffer.from(buf);
      _writeDiskCache(cacheDir, cachePath, jpegBuf);
      return { dataUrl: `data:image/jpeg;base64,${jpegBuf.toString('base64')}` };
    }
  }

  if (typeof image.toDataURL === 'function') {
    const dataUrl = image.toDataURL();
    if (dataUrl) return { dataUrl };
  }

  throw new Error('unable to encode thumbnail');
}

module.exports = {
  assertSafeLocalPath,
  createLocalThumbnail,
  setThumbnailCacheDir,
  getThumbnailCacheDir,
};
