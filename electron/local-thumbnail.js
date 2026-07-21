/**
 * Lightweight local image thumbnails via Electron nativeImage.
 * Path A for conversion grid display — never touches Python preview_image.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_EDGE = 256;
const MIN_MAX_EDGE = 32;
const MAX_MAX_EDGE = 1024;
const JPEG_QUALITY = 60;

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

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error('not a file');
  }
  if (!stat.isFile()) {
    throw new Error('not a file');
  }
  return resolved;
}

function clampMaxEdge(maxEdge) {
  const n = typeof maxEdge === 'number' && Number.isFinite(maxEdge) ? Math.floor(maxEdge) : DEFAULT_MAX_EDGE;
  if (n < MIN_MAX_EDGE) return MIN_MAX_EDGE;
  if (n > MAX_MAX_EDGE) return MAX_MAX_EDGE;
  return n;
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
      return { dataUrl: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` };
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
};
