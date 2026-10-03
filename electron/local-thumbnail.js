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
const DISK_CACHE_TRIM_INTERVAL_MS = 60 * 1000;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_THUMBNAIL_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 150 * 1000 * 1000;
const _JPEG_MAX_SEGMENTS = 512;
const _JPEG_SOF_MARKERS = new Set([
  0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
  0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
]);

const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

let _cacheDir = null;
let _trimScheduled = false;
let _trimAfterWrite = false;
let _nextReadTrimAt = 0;

function setThumbnailCacheDir(dir) {
  _nextReadTrimAt = 0;
  _cacheDir = dir ? String(dir) : null;
}

function getThumbnailCacheDir() {
  if (_cacheDir) return _cacheDir;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'thumb-cache');
    }
  } catch {
  }
  return path.join(os.tmpdir(), 'antares-thumb-cache');
}

function assertSafeLocalPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('invalid path');
  }
  if (filePath.includes('\0')) {
    throw new Error('invalid path');
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error('path must be absolute');
  }

  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved)) {
    throw new Error('path must be absolute');
  }

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
    try {
      const now = new Date();
      await fsp.utimes(cachePath, now, now);
    } catch {
    }
    _scheduleTrim(path.dirname(cachePath));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    return null;
  }
}

function _scheduleTrim(cacheDir, afterWrite = false) {
  if (_trimScheduled) {
    if (afterWrite) _trimAfterWrite = true;
    return;
  }
  if (!afterWrite && Date.now() < _nextReadTrimAt) return;
  _trimScheduled = true;
  _nextReadTrimAt = Date.now() + DISK_CACHE_TRIM_INTERVAL_MS;
  setImmediate(() => {
    _trimAfterWrite = false;
    _trimDiskCache(cacheDir).catch((err) => {
      console.warn('[local-thumbnail] trim de cache falló:', err && err.message ? err.message : err);
    }).finally(() => {
      _trimScheduled = false;
      if (_trimAfterWrite) {
        _trimAfterWrite = false;
        _scheduleTrim(cacheDir, true);
      }
    });
  });
}

async function _writeDiskCache(cacheDir, cachePath, jpegBuf) {
  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, jpegBuf);
    await fsp.rename(tmp, cachePath);
    _scheduleTrim(cacheDir, true);
  } catch (err) {
    console.warn('[local-thumbnail] escritura de cache falló:', err && err.message ? err.message : err);
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
        }
      }),
    );
  } catch {
  }
}

function _isPngHeader(head) {
  return head.length >= 24
    && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47
    && head[4] === 0x0D && head[5] === 0x0A && head[6] === 0x1A && head[7] === 0x0A
    && head.toString('latin1', 12, 16) === 'IHDR';
}

function _webpDimensions(head) {
  const kind = head.toString('latin1', 12, 16);
  if (kind === 'VP8X' && head.length >= 30) {
    return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ' && head.length >= 30
      && head[23] === 0x9D && head[24] === 0x01 && head[25] === 0x2A) {
    return { width: head.readUInt16LE(26) & 0x3FFF, height: head.readUInt16LE(28) & 0x3FFF };
  }
  if (kind === 'VP8L' && head.length >= 25 && head[20] === 0x2F) {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
  }
  return null;
}

async function _jpegDimensions(read) {
  let pos = 2;
  for (let i = 0; i < _JPEG_MAX_SEGMENTS; i++) {
    let marker = -1;
    for (;;) {
      const bytes = await read(pos, 2);
      if (!bytes || bytes.length < 2 || bytes[0] !== 0xFF) return null;
      if (bytes[1] === 0xFF) { pos += 1; continue; }
      marker = bytes[1];
      pos += 2;
      break;
    }
    if (marker === 0xDA) return null; // SOS: entropy-coded data follows
    if (marker === 0x01 || marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    const lenBuf = await read(pos, 2);
    if (!lenBuf || lenBuf.length < 2) return null;
    const segLen = lenBuf.readUInt16BE(0);
    if (segLen < 2) return null;
    if (_JPEG_SOF_MARKERS.has(marker)) {
      const data = await read(pos + 2, 5);
      if (!data || data.length < 5) return null;
      return { height: data.readUInt16BE(1), width: data.readUInt16BE(3) };
    }
    pos += segLen;
  }
  return null;
}

async function _probeImageDimensions(read) {
  const head = await read(0, 64);
  if (!head || head.length < 10) return null;
  if (_isPngHeader(head)) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  }
  const magic6 = head.toString('latin1', 0, 6);
  if (magic6 === 'GIF87a' || magic6 === 'GIF89a') {
    return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
  }
  if (head[0] === 0x42 && head[1] === 0x4D && head.length >= 26) {
    const dibSize = head.readUInt32LE(14);
    if (dibSize === 12) return { width: head.readUInt16LE(18), height: head.readUInt16LE(20) };
    if (dibSize >= 40) {
      return { width: Math.abs(head.readInt32LE(18)), height: Math.abs(head.readInt32LE(22)) };
    }
    return null;
  }
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return _webpDimensions(head);
  }
  if (head.length >= 22 && head.readUInt16LE(0) === 0 && head.readUInt16LE(2) === 1) {
    // ICO: first directory entry declares dims; PNG payloads carry their own header.
    if (head.readUInt16LE(4) < 1) return null;
    const inner = await read(head.readUInt32LE(18), 24);
    if (inner && _isPngHeader(inner)) {
      return { width: inner.readUInt32BE(16), height: inner.readUInt32BE(20) };
    }
    return { width: head[6] || 256, height: head[7] || 256 };
  }
  if (head[0] === 0xFF && head[1] === 0xD8) return _jpegDimensions(read);
  return null;
}

function _bufferReader(buf) {
  return async (offset, len) => {
    if (offset >= buf.length) return null;
    return buf.subarray(offset, Math.min(offset + len, buf.length));
  };
}

function _probeImageDimensionsFromBuffer(buf) {
  if (!buf || !buf.length) return Promise.resolve(null);
  return _probeImageDimensions(_bufferReader(buf));
}

async function _probeImageFileDimensions(filePath) {
  let handle = null;
  try {
    handle = await fsp.open(filePath, 'r');
    const read = async (offset, len) => {
      const out = Buffer.alloc(len);
      const { bytesRead } = await handle.read(out, 0, len, offset);
      return bytesRead > 0 ? out.subarray(0, bytesRead) : null;
    };
    return await _probeImageDimensions(read);
  } catch {
    return null;
  } finally {
    if (handle) {
      try { await handle.close(); } catch {}
    }
  }
}

async function createLocalThumbnail(filePath, maxEdge, nativeImage) {
  if (!nativeImage) {
    throw new Error('nativeImage not available');
  }

  const resolved = assertSafeLocalPath(filePath);
  const edge = clampMaxEdge(maxEdge);

  let st;
  try {
    st = await fsp.stat(resolved);
  } catch {
    throw new Error('unable to load image');
  }
  if (st.size > MAX_THUMBNAIL_SOURCE_BYTES) {
    throw new Error('image too large');
  }
  const dims = await _probeImageFileDimensions(resolved);
  if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) {
    throw new Error('image too large');
  }
  const fileSignature = `${st.mtimeMs}|${st.size}|${st.ctimeMs}`;

  const cacheDir = getThumbnailCacheDir();
  const cachePath = path.join(cacheDir, `${_cacheKey(resolved, fileSignature, edge)}.jpg`);
  const cached = await _readDiskCache(cachePath);
  if (cached) return { dataUrl: cached };

  let image = null;

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
  // El stat previo no es suficiente: el archivo pudo crecer entre stat y read.
  if (buf.length > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error('image too large');
  }
  const dims = await _probeImageDimensionsFromBuffer(buf);
  if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) {
    throw new Error('image too large');
  }
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}

module.exports = {
  assertSafeLocalPath,
  createLocalThumbnail,
  createLocalImageDataUrl,
  setThumbnailCacheDir,
  _trimDiskCache,
  _probeImageDimensionsFromBuffer,
  DISK_CACHE_MAX_FILES,
  DISK_CACHE_MAX_BYTES,
  MAX_THUMBNAIL_SOURCE_BYTES,
  MAX_IMAGE_PIXELS,
};
