// Canvas asset GC: drop unreferenced files older than grace period.
const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

async function main() {
  console.log('Testing canvas asset GC...\n');

  // Isolate under a temp LOCALAPPDATA so we do not touch real user assets.
  const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'antares-asset-gc-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = fakeHome;

  try {
    // Fresh require after env so assetsDir() picks up fake root.
    delete require.cache[require.resolve('../electron/canvas-assets.js')];
    const {
      putCanvasAsset,
      assetsDir,
      gcOrphanCanvasAssets,
      GC_GRACE_MS,
      toAssetRef,
    } = require('../electron/canvas-assets.js');

    const keptBytes = Buffer.from('kept-asset-bytes-aaaaaaaa');
    const orphanBytes = Buffer.from('orphan-asset-bytes-bbbbbbbb');
    const kept = await putCanvasAsset(keptBytes);
    const orphan = await putCanvasAsset(orphanBytes);

    const docsDir = path.join(fakeHome, 'Antares', 'canvas', 'documents');
    await fsp.mkdir(docsDir, { recursive: true });
    await fsp.writeFile(
      path.join(docsDir, 'doc1.json'),
      JSON.stringify({ layers: [{ value: kept.ref }] }),
      'utf8',
    );

    // Age the orphan past grace; keep "kept" young / referenced.
    const orphanPath = path.join(assetsDir(), orphan.asset_id);
    const old = (Date.now() - GC_GRACE_MS - 60_000) / 1000;
    fs.utimesSync(orphanPath, old, old);

    const nowMs = Date.now();
    const res = await gcOrphanCanvasAssets({ nowMs, graceMs: GC_GRACE_MS });
    assert.ok(res.removed >= 1, `expected orphan removed, got ${JSON.stringify(res)}`);
    assert.strictEqual(fs.existsSync(orphanPath), false, 'orphan file deleted');
    assert.ok(fs.existsSync(path.join(assetsDir(), kept.asset_id)), 'referenced asset kept');
    assert.ok(toAssetRef(kept.asset_id).startsWith('canvas-asset:'));

    // Fresh orphan within grace must survive.
    const young = await putCanvasAsset(Buffer.from('young-orphan-cccccccc'));
    const youngPath = path.join(assetsDir(), young.asset_id);
    const grace = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(youngPath), 'young unreferenced asset kept by grace');
    assert.ok(grace.skippedGrace >= 1, 'skippedGrace counted');

    console.log('  ✓ GC removes stale orphans, keeps refs + grace');
    console.log('\nAll canvas-asset-gc tests passed.');
  } finally {
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    await fsp.rm(fakeHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
