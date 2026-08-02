/**
 * Disk cache for Electron local thumbnails (path + mtime + edge).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const {
    createLocalThumbnail,
    setThumbnailCacheDir,
    _trimDiskCache,
    DISK_CACHE_MAX_FILES,
  } = require('../electron/local-thumbnail');
  const { registerAllowedReadPath, clearAllowedReadPaths } = require('../electron/path-allowlist');

  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-thumb-test-'));
  setThumbnailCacheDir(cacheDir);
  clearAllowedReadPaths();

  // Minimal 1x1 JPEG
  const jpegB64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
  const src = path.join(cacheDir, 'source.jpg');
  fs.writeFileSync(src, Buffer.from(jpegB64, 'base64'));
  registerAllowedReadPath(src);

  let createFromPathCalls = 0;
  const nativeImage = {
    createFromPath() {
      createFromPathCalls += 1;
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 1, height: 1 }),
        toJPEG: () => Buffer.from(jpegB64, 'base64'),
      };
    },
  };

  const first = await createLocalThumbnail(src, 64, nativeImage);
  assert(first.dataUrl.startsWith('data:image/jpeg'), 'first thumb is jpeg data url');
  assert(createFromPathCalls === 1, 'first call decodes image');

  // Allow deferred trim setImmediate to flush without affecting cache hit.
  await sleep(20);

  const cachedFiles = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg') && n !== 'source.jpg');
  assert(cachedFiles.length >= 1, 'disk cache file written');

  const second = await createLocalThumbnail(src, 64, nativeImage);
  assert(second.dataUrl === first.dataUrl, 'second call returns same data url');
  assert(createFromPathCalls === 1, 'second call hits disk cache (no re-decode)');

  // Deferred trim must not delete a valid entry when under the cap.
  await _trimDiskCache(cacheDir);
  const afterTrim = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg') && n !== 'source.jpg');
  assert(afterTrim.length >= 1, 'trim keeps cache entries under max');

  // Force excess cache files and ensure trim removes oldest.
  const excess = 5;
  for (let i = 0; i < DISK_CACHE_MAX_FILES + excess; i += 1) {
    const fake = path.join(cacheDir, `pad-${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(fake, Buffer.from(`pad-${i}`));
    // Stagger mtimes so sort is deterministic on some filesystems.
    const past = new Date(Date.now() - (DISK_CACHE_MAX_FILES + excess - i) * 1000);
    fs.utimesSync(fake, past, past);
  }
  await _trimDiskCache(cacheDir);
  const jpgCount = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg')).length;
  // source.jpg + cached thumb + pads, but trim only counts *.jpg and caps at MAX.
  assert(jpgCount <= DISK_CACHE_MAX_FILES, `trim caps jpg files at ${DISK_CACHE_MAX_FILES}, got ${jpgCount}`);

  console.log('[PASS] local-thumbnail disk cache OK.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
