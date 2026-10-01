
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertOrExit:assert } = require('./helpers/harness');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const scheduled = [];
  let now = 0;
  let scans = 0;
  let stats = 0;
  let cacheMiss = false;
  let holdScan = null;
  const fakeFs = {
    readFile: async () => {
      if (cacheMiss) {
        cacheMiss = false;
        throw Object.assign(new Error('cache miss'), { code: 'ENOENT' });
      }
      return Buffer.from('jpeg');
    },
    utimes: async () => {}, mkdir: async () => {}, writeFile: async () => {}, rename: async () => {},
    readdir: async () => {
      scans += 1;
      if (holdScan) await holdScan;
      return Array.from({ length: 400 }, (_, i) => `${i}.jpg`);
    },
    stat: async () => { stats += 1; return { mtimeMs: 1, ctimeMs: 1, size: 4 }; },
  };
  const isolated = { exports: {} };
  class TestDate extends Date { static now() { return now; } }
  new Function('module', 'require', 'setImmediate', 'Date', fs.readFileSync(require.resolve('../electron/local-thumbnail'), 'utf8'))(
    isolated,
    (name) => name === 'fs' ? { promises: fakeFs }
      : name === './path-allowlist' ? { assertAllowedReadPath: (p) => p } : require(name),
    (callback) => scheduled.push(callback), TestDate,
  );
  const fakeSource = path.resolve('source.jpg');
  const fakeNativeImage = { createFromPath: () => ({ isEmpty: () => false, toJPEG: () => Buffer.from('jpeg') }) };
  async function flushTrim() {
    while (scheduled.length) {
      scheduled.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  isolated.exports.setThumbnailCacheDir(path.resolve('cache'));
  for (let i = 0; i < 40; i += 1) {
    await isolated.exports.createLocalThumbnail(fakeSource, 64, fakeNativeImage);
    await flushTrim();
  }
  assert(scans === 1 && stats === 440, `40 cache hits need one sweep, got ${scans} sweeps and ${stats} stats`);
  now = 60_000;
  await isolated.exports.createLocalThumbnail(fakeSource, 64, fakeNativeImage);
  await flushTrim();
  assert(scans === 2, 'reads schedule another sweep after the interval');

  let releaseScan;
  holdScan = new Promise((resolve) => { releaseScan = resolve; });
  now = 120_000;
  await isolated.exports.createLocalThumbnail(fakeSource, 64, fakeNativeImage);
  await flushTrim();
  now = 180_000;
  await isolated.exports.createLocalThumbnail(fakeSource, 64, fakeNativeImage);
  await flushTrim();
  assert(scans === 3, 'a pending sweep never overlaps another sweep');
  for (const edge of [65, 66]) {
    cacheMiss = true;
    await isolated.exports.createLocalThumbnail(fakeSource, edge, fakeNativeImage);
    await flushTrim();
  }
  assert(scans === 3, 'writes during a pending sweep wait for it to finish');
  releaseScan();
  holdScan = null;
  await new Promise((resolve) => setImmediate(resolve));
  await flushTrim();
  assert(scans === 4, 'writes during a sweep trigger one follow-up sweep');
  cacheMiss = true;
  await isolated.exports.createLocalThumbnail(fakeSource, 67, fakeNativeImage);
  await flushTrim();
  assert(scans === 5, 'writes trigger a sweep even inside the read interval');
  for (const edge of [68, 69]) {
    cacheMiss = true;
    await isolated.exports.createLocalThumbnail(fakeSource, edge, fakeNativeImage);
  }
  await flushTrim();
  assert(scans === 6, 'writes queued before a sweep coalesce into that sweep');

  const {
    createLocalThumbnail,
    setThumbnailCacheDir,
    _trimDiskCache,
    DISK_CACHE_MAX_FILES,
    DISK_CACHE_MAX_BYTES,
  } = require('../electron/local-thumbnail');
  const { registerAllowedReadPath, clearAllowedReadPaths } = require('../electron/path-allowlist');

  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-thumb-test-'));
  setThumbnailCacheDir(cacheDir);
  clearAllowedReadPaths();

  const jpegB64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antares-thumb-source-'));
  const src = path.join(sourceDir, 'source.jpg');
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

  await sleep(20);

  const cachedFiles = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg') && n !== 'source.jpg');
  assert(cachedFiles.length >= 1, 'disk cache file written');

  const second = await createLocalThumbnail(src, 64, nativeImage);
  assert(second.dataUrl === first.dataUrl, 'second call returns same data url');
  assert(createFromPathCalls === 1, 'second call hits disk cache (no re-decode)');

  fs.writeFileSync(src, Buffer.from(jpegB64, 'base64'));
  fs.utimesSync(src, new Date(1_000_000_000), new Date(1_000_000_000));
  await createLocalThumbnail(src, 64, nativeImage);
  assert(createFromPathCalls === 2, 'same-size replacement does not reuse stale thumb');

  await _trimDiskCache(cacheDir);
  const afterTrim = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg') && n !== 'source.jpg');
  assert(afterTrim.length >= 1, 'trim keeps cache entries under max');

  const excess = 5;
  for (let i = 0; i < DISK_CACHE_MAX_FILES + excess; i += 1) {
    const fake = path.join(cacheDir, `pad-${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(fake, Buffer.from(`pad-${i}`));
    const past = new Date(Date.now() - (DISK_CACHE_MAX_FILES + excess - i) * 1000);
    fs.utimesSync(fake, past, past);
  }
  await _trimDiskCache(cacheDir);
  const jpgCount = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.jpg')).length;
  assert(jpgCount <= DISK_CACHE_MAX_FILES, `trim caps jpg files at ${DISK_CACHE_MAX_FILES}, got ${jpgCount}`);

  const cacheFilesBeforeLruCheck = fs.readdirSync(cacheDir)
    .filter((n) => n.endsWith('.jpg') && n !== 'source.jpg')
    .sort((a, b) => fs.statSync(path.join(cacheDir, b)).mtimeMs - fs.statSync(path.join(cacheDir, a)).mtimeMs);
  assert(cacheFilesBeforeLruCheck.length >= 1, 'cache entry remains for LRU check');
  const cachedPath = path.join(cacheDir, cacheFilesBeforeLruCheck[0]);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(cachedPath, old, old);
  await createLocalThumbnail(src, 64, nativeImage);
  await _trimDiskCache(cacheDir);
  assert(fs.existsSync(cachedPath), 'reading a thumb refreshes its LRU position');

  await _trimDiskCache(cacheDir, { maxFiles: DISK_CACHE_MAX_FILES, maxBytes: 10 });
  const remainingBytes = fs.readdirSync(cacheDir)
    .filter((n) => n.endsWith('.jpg'))
    .reduce((total, name) => total + fs.statSync(path.join(cacheDir, name)).size, 0);
  assert(remainingBytes <= 10, `trim caps disk bytes (default ${DISK_CACHE_MAX_BYTES}), got ${remainingBytes}`);

  console.log('[PASS] local-thumbnail disk cache OK.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
