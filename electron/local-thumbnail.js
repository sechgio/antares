/**
 * Lightweight local image thumbnails via Electron nativeImage.
 * Path A for conversion grid display — never touches Python preview_image.
 *
 * Optional on-disk cache keyed by path + file signature + maxEdge so revisiting a
 * folder across sessions avoids re-decoding via nativeImage.
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const os = require('os');
const { assertAllowedReadPath } = require('./path-allowlist');

const DEFAULT_MAX_EDGE = 256;
const MIN_MAX_EDGE = 32;
const MAX_MAX_EDGE = 1024;
const JPEG_QUALITY = 60;
const DISK_CACHE_MAX_FILES = 400;
const DISK_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** Cap for full-fidelity local → data URL reads (Ubicaciones preview, etc.). */
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;

const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

let _cacheDir = null;
let _trimScheduled = false;

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

function _cacheKey(resolved, fileSignature, edge) {
  return crypto
    .createHash('sha1')
    .update(`${resolved}|${fileSignature}|${edge}`)
    .digest('hex');
}

async function _readDiskCache(cachePath) {
  try {
    const buf = await fsp.readFile(cachePath);
    if (!buf || !buf.length) return null;
    // atime is not reliable on Windows/NTFS, so explicitly refresh mtime to
    // make the disk cache eviction order reflect actual use (LRU), not writes.
    try {
      const now = new Date();
      await fsp.utimes(cachePath, now, now);
    } catch {
      /* cache hit remains valid when touching is unavailable */
    }
    _scheduleTrim(path.dirname(cachePath));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    return null;
  }
}

function _scheduleTrim(cacheDir) {
  if (_trimScheduled) return;
  _trimScheduled = true;
  setImmediate(() => {
    _trimScheduled = false;
    _trimDiskCache(cacheDir).catch(() => {
      /* ignore */
    });
  });
}

async function _writeDiskCache(cacheDir, cachePath, jpegBuf) {
  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, jpegBuf);
    await fsp.rename(tmp, cachePath);
    _scheduleTrim(cacheDir);
  } catch {
    /* disk full / permissions — non-fatal */
  }
}

async function _trimDiskCache(cacheDir, { maxFiles = DISK_CACHE_MAX_FILES, maxBytes = DISK_CACHE_MAX_BYTES } = {}) {
  try {
    const names = await fsp.readdir(cacheDir);
    const jpgNames = names.filter((name) => name.endsWith('.jpg'));

    const entries = await Promise.all(
      jpgNames.map(async (name) => {
        const full = path.join(cacheDir, name);
        try {
          const st = await fsp.stat(full);
          return { full, mtimeMs: st.mtimeMs, size: st.size };
        } catch {
          return { full, mtimeMs: 0, size: 0 };
        }
      }),
    );

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    const staleEntries = [];
    while (
      (entries.length - staleEntries.length > maxFiles || totalBytes > maxBytes)
      && staleEntries.length < entries.length
    ) {
      const stale = entries[staleEntries.length];
      staleEntries.push(stale);
      totalBytes = Math.max(0, totalBytes - stale.size);
    }
    if (staleEntries.length === 0) return;

    await Promise.all(
      staleEntries.map(async (entry) => {
        try {
          await fsp.unlink(entry.full);
        } catch {
          /* ignore */
        }
      }),
    );
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

  let fileSignature = '';
  try {
    const st = await fsp.stat(resolved);
    // mtime alone can be preserved by copy tools/editors. Size and ctime add
    // cheap protection against serving bytes from a replaced local image.
    fileSignature = `${st.mtimeMs}|${st.size}|${st.ctimeMs}`;
  } catch {
    throw new Error('unable to load image');
  }

  const cacheDir = getThumbnailCacheDir();
  const cachePath = path.join(cacheDir, `${_cacheKey(resolved, fileSignature, edge)}.jpg`);
  const cached = await _readDiskCache(cachePath);
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
      await _writeDiskCache(cacheDir, cachePath, jpegBuf);
      return { dataUrl: `data:image/jpeg;base64,${jpegBuf.toString('base64')}` };
    }
  }

  if (typeof image.toDataURL === 'function') {
    const dataUrl = image.toDataURL();
    if (dataUrl) return { dataUrl };
  }

  throw new Error('unable to encode thumbnail');
}

/**
 * Read an allowlisted local image as a data URL without resize/recompress.
 * Used for composed previews (e.g. Ubicaciones) where file:// is blocked by CSP.
 * @param {unknown} filePath absolute local path
 * @returns {Promise<{ dataUrl: string }>}
 */
async function createLocalImageDataUrl(filePath) {
  const resolved = assertSafeLocalPath(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) {
    throw new Error('unsupported image type');
  }

  let st;
  try {
    st = await fsp.stat(resolved);
  } catch {
    throw new Error('unable to load image');
  }
  if (!st.isFile()) {
    throw new Error('not a file');
  }
  if (st.size <= 0 || st.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error('image too large');
  }

  const buf = await fsp.readFile(resolved);
  if (!buf || !buf.length) {
    throw new Error('unable to load image');
  }
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}

module.exports = {
  assertSafeLocalPath,
  createLocalThumbnail,
  createLocalImageDataUrl,
  setThumbnailCacheDir,
  getThumbnailCacheDir,
  // Test helpers (not part of public IPC contract)
  _trimDiskCache,
  DISK_CACHE_MAX_FILES,
  DISK_CACHE_MAX_BYTES,
  MAX_LOCAL_IMAGE_BYTES,
};
