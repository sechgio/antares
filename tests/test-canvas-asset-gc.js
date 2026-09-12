const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

async function main() {
  console.log('Testing canvas asset GC...\n');

  const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'antares-asset-gc-'));
  const prev = process.env.LOCALAPPDATA;
  const prevXdg = process.env.XDG_DATA_HOME;
  process.env.LOCALAPPDATA = fakeHome;
  process.env.XDG_DATA_HOME = fakeHome;

  try {
    delete require.cache[require.resolve('../electron/canvas-assets.js')];
    const {
      putCanvasAsset,
      getCanvasAsset,
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

    // A pending marker protects an unreferenced asset past the mtime grace —
    // this is the put-vs-GC window for a doc that has not been saved yet.
    const pendingAsset = await putCanvasAsset(Buffer.from('pending-asset-eeeeeeee'));
    const pendingAssetPath = path.join(assetsDir(), pendingAsset.asset_id);
    const pendingOld = (Date.now() - GC_GRACE_MS - 60_000) / 1000;
    fs.utimesSync(pendingAssetPath, pendingOld, pendingOld);
    const protectedRes = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(pendingAssetPath), 'pending asset kept past mtime grace');
    assert.ok(protectedRes.removed === 0, `nothing removed while pending: ${JSON.stringify(protectedRes)}`);

    // Once the marker expires (or the asset gets referenced), GC can collect it.
    const pendingFile = path.join(fakeHome, 'Antares', 'canvas', 'spill', 'pending-assets.json');
    await fsp.writeFile(
      pendingFile,
      JSON.stringify([
        { id: pendingAsset.asset_id, at: Date.now() - 8 * 24 * 60 * 60 * 1000 },
        { id: orphan.asset_id, at: Date.now() },
      ]),
      'utf8',
    );
    const expiredRes = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(expiredRes.removed >= 1, 'expired pending marker no longer protects');
    assert.strictEqual(fs.existsSync(pendingAssetPath), false, 'expired pending asset collected');

    const orphanPath = path.join(assetsDir(), orphan.asset_id);
    const old = (Date.now() - GC_GRACE_MS - 60_000) / 1000;
    fs.utimesSync(orphanPath, old, old);
    // Expire the orphan's marker too so this GC pass can collect it.
    await fsp.writeFile(
      pendingFile,
      JSON.stringify([{ id: orphan.asset_id, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }]),
      'utf8',
    );

    const nowMs = Date.now();
    const res = await gcOrphanCanvasAssets({ nowMs, graceMs: GC_GRACE_MS });
    assert.ok(res.removed >= 1, `expected orphan removed, got ${JSON.stringify(res)}`);
    assert.strictEqual(fs.existsSync(orphanPath), false, 'orphan file deleted');
    assert.ok(fs.existsSync(path.join(assetsDir(), kept.asset_id)), 'referenced asset kept');
    assert.ok(toAssetRef(kept.asset_id).startsWith('canvas-asset:'));

    const spillDir = path.join(fakeHome, 'Antares', 'canvas', 'spill');
    await fsp.mkdir(spillDir, { recursive: true });
    const spillAsset = await putCanvasAsset(Buffer.from('spill-asset-dddddddd'));
    const spillAssetPath = path.join(assetsDir(), spillAsset.asset_id);
    await fsp.writeFile(
      path.join(spillDir, 'pending.json'),
      JSON.stringify({ layers: [{ value: spillAsset.ref }] }),
      'utf8',
    );
    const spillOld = (Date.now() - GC_GRACE_MS - 60_000) / 1000;
    fs.utimesSync(spillAssetPath, spillOld, spillOld);
    const spillRes = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(spillRes.kept >= 2, 'assets referenced by spill are kept');
    assert.ok(fs.existsSync(spillAssetPath), 'spill-referenced asset kept');

    const staleTempPath = path.join(assetsDir(), `.${'a'.repeat(64)}.write.tmp`);
    await fsp.writeFile(staleTempPath, 'partial', 'utf8');
    fs.utimesSync(staleTempPath, spillOld, spillOld);
    const tempRes = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(tempRes.removed >= 1, `stale asset temp files are removed: ${JSON.stringify(tempRes)}`);
    assert.strictEqual(fs.existsSync(staleTempPath), false, 'stale temp deleted');

    const corrupt = await putCanvasAsset(Buffer.from('corrupt-me-eeeeeeee'));
    await fsp.writeFile(path.join(assetsDir(), corrupt.asset_id), 'corrupt', 'utf8');
    await assert.rejects(() => getCanvasAsset(corrupt.ref), /checksum/i);
    const repaired = await putCanvasAsset(Buffer.from('corrupt-me-eeeeeeee'));
    assert.deepStrictEqual(
      Buffer.from(await getCanvasAsset(repaired.ref)),
      Buffer.from('corrupt-me-eeeeeeee'),
      'put repairs a corrupted content-addressed asset',
    );

    const young = await putCanvasAsset(Buffer.from('young-orphan-cccccccc'));
    const youngPath = path.join(assetsDir(), young.asset_id);
    // With a live pending marker the young asset is protected without grace.
    await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(youngPath), 'young unreferenced asset kept by pending marker');
    // Expire the marker: the mtime grace window still protects a fresh write.
    await fsp.writeFile(
      pendingFile,
      JSON.stringify([{ id: young.asset_id, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }]),
      'utf8',
    );
    const grace = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(youngPath), 'young unreferenced asset kept by grace');
    assert.ok(grace.skippedGrace >= 1, 'skippedGrace counted');

    console.log('  ✓ GC removes stale orphans, keeps refs + grace');
    console.log('\nAll canvas-asset-gc tests passed.');
  } finally {
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    await fsp.rm(fakeHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
