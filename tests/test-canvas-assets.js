const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  putCanvasAsset,
  getCanvasAsset,
  getCanvasAssetInfo,
  parseAssetRef,
  toAssetRef,
  assetsDir,
} = require('../electron/canvas-assets.js');

async function main() {
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const first = await putCanvasAsset(payload);
  assert.ok(first.ref.startsWith('canvas-asset:'));
  assert.strictEqual(parseAssetRef(first.ref), first.asset_id);

  const second = await putCanvasAsset(payload);
  assert.strictEqual(second.asset_id, first.asset_id, 'identical bytes must dedupe by sha256');

  const loaded = await getCanvasAsset(first.ref);
  assert.ok(loaded.equals(payload));

  const info = await getCanvasAssetInfo(first.ref);
  assert.deepStrictEqual(info, { asset_id: first.asset_id, ref: first.ref, bytes: payload.length });

  const cacheCandidate = await putCanvasAsset(Buffer.from('checksum-cache-payload'));
  let sha256Calls = 0;
  const realCreateHash = crypto.createHash;
  crypto.createHash = (algorithm, ...args) => {
    if (algorithm === 'sha256') sha256Calls += 1;
    return realCreateHash.call(crypto, algorithm, ...args);
  };
  try {
    await getCanvasAsset(cacheCandidate.ref);
    await getCanvasAsset(cacheCandidate.ref);
  } finally {
    crypto.createHash = realCreateHash;
  }
  assert.strictEqual(sha256Calls, 1, 'repeated reads should reuse the bounded stat-keyed checksum cache');

  const diskPath = path.join(assetsDir(), first.asset_id);
  assert.ok(fs.existsSync(diskPath));

  await fsp.rm(diskPath, { force: true });

  console.log('  ✓ canvas asset put/get + sha256 dedupe');
  console.log('\nAll canvas-assets tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
