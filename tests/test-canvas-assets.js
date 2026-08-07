// Canvas assets on disk (no base64 through IPC).
const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  putCanvasAsset,
  getCanvasAsset,
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

  const diskPath = path.join(assetsDir(), first.asset_id);
  assert.ok(fs.existsSync(diskPath));

  // Cleanup this test asset only
  await fsp.rm(diskPath, { force: true });

  console.log('  ✓ canvas asset put/get + sha256 dedupe');
  console.log('\nAll canvas-assets tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
