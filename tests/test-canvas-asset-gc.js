const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const { evictModule } = require('./helpers/harness');

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
    evictModule('electron/canvas-assets.js');
    const {
      putCanvasAsset,
      getCanvasAsset,
      getCanvasAssetInfo,
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

    // El marcador protege assets aún no referenciados después de vencer la gracia del mtime.
    const pendingAsset = await putCanvasAsset(Buffer.from('pending-asset-eeeeeeee'));
    const pendingAssetPath = path.join(assetsDir(), pendingAsset.asset_id);
    const pendingOld = (Date.now() - GC_GRACE_MS - 60_000) / 1000;
    fs.utimesSync(pendingAssetPath, pendingOld, pendingOld);
    const protectedRes = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(pendingAssetPath), 'pending asset kept past mtime grace');
    assert.ok(protectedRes.removed === 0, `nothing removed while pending: ${JSON.stringify(protectedRes)}`);

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
    // Vence también el marcador del huérfano para permitir su recolección.
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
    await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(youngPath), 'young unreferenced asset kept by pending marker');
    // Al vencer el marcador, la gracia del mtime aún protege el asset reciente.
    await fsp.writeFile(
      pendingFile,
      JSON.stringify([{ id: young.asset_id, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }]),
      'utf8',
    );
    const grace = await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(youngPath), 'young unreferenced asset kept by grace');
    assert.ok(grace.skippedGrace >= 1, 'skippedGrace counted');

    const reusableBytes = Buffer.from('reusable-image-bytes');
    const reusable = await putCanvasAsset(reusableBytes);
    const reusablePath = path.join(assetsDir(), reusable.asset_id);
    fs.utimesSync(reusablePath, old, old);
    await fsp.writeFile(pendingFile, JSON.stringify([{ id: reusable.asset_id, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }]));
    const realReadFile = fsp.readFile;
    const realCreateHash = crypto.createHash;
    let assetReads = 0;
    let checksumCalls = 0;
    fsp.readFile = async (file, ...args) => {
      if (file === reusablePath) assetReads += 1;
      return realReadFile.call(fsp, file, ...args);
    };
    crypto.createHash = (algorithm, ...args) => {
      if (algorithm === 'sha256') checksumCalls += 1;
      return realCreateHash.call(crypto, algorithm, ...args);
    };
    try {
      for (let i = 0; i < 3; i += 1) {
        assert.deepStrictEqual(await getCanvasAssetInfo(reusable.ref), {
          ref: reusable.ref, asset_id: reusable.asset_id, bytes: reusableBytes.length,
        });
      }
      assert.strictEqual(assetReads, 1, 'unchanged asset info reads and verifies the bytes only once');
      assert.strictEqual(checksumCalls, 1, 'asset info reuses the bounded stat-keyed checksum cache');
    } finally {
      fsp.readFile = realReadFile;
      crypto.createHash = realCreateHash;
    }
    await gcOrphanCanvasAssets({ graceMs: GC_GRACE_MS });
    assert.ok(fs.existsSync(reusablePath), 'reusing an old asset renews its pending marker before document save');
    await fsp.writeFile(reusablePath, Buffer.alloc(reusableBytes.length, 0));
    fs.utimesSync(reusablePath, old + 1, old + 1);
    await assert.rejects(() => getCanvasAssetInfo(reusable.ref), /checksum/i);
    await putCanvasAsset(reusableBytes);
    assert.deepStrictEqual(await getCanvasAsset(reusable.ref), reusableBytes, 'same-sized corruption can be repaired');
    await fsp.rm(reusablePath);
    await assert.rejects(() => getCanvasAssetInfo(reusable.ref), /ENOENT/);
    await putCanvasAsset(reusableBytes);
    assert.strictEqual((await getCanvasAssetInfo(reusable.ref)).ref, reusable.ref, 'a deleted asset can be restored');

    const racing = await putCanvasAsset(Buffer.from('GC-before-reference-validation'));
    const racingPath = path.join(assetsDir(), racing.asset_id);
    fs.utimesSync(racingPath, old, old);
    await fsp.writeFile(pendingFile, '[]');
    let releaseGc;
    let signalGc;
    const gcPaused = new Promise((resolve) => { signalGc = resolve; });
    const gcGate = new Promise((resolve) => { releaseGc = resolve; });
    let pauseNextRead = true;
    const realStat = fsp.stat;
    let validationStarted = false;
    fsp.stat = async (file, ...args) => {
      if (file === racingPath) validationStarted = true;
      return realStat.call(fsp, file, ...args);
    };
    fsp.readFile = async (file, ...args) => {
      if (file === pendingFile && pauseNextRead) {
        pauseNextRead = false;
        signalGc();
        await gcGate;
      }
      return realReadFile.call(fsp, file, ...args);
    };
    try {
      const collecting = gcOrphanCanvasAssets({ graceMs: GC_GRACE_MS });
      await gcPaused;
      const checked = getCanvasAssetInfo(racing.ref).then(() => null, (error) => error);
      await Promise.resolve();
      assert.strictEqual(validationStarted, false, 'reference validation waits until GC releases the write lock');
      releaseGc();
      await collecting;
      const missing = await checked;
      assert.ok(missing && /ENOENT/.test(missing.message), 'validation after GC must reject a deleted cached ref');
      await putCanvasAsset(Buffer.from('GC-before-reference-validation'));
      await Promise.all([getCanvasAssetInfo(racing.ref), gcOrphanCanvasAssets({ graceMs: GC_GRACE_MS })]);
      assert.ok(fs.existsSync(racingPath), 'validation before GC protects the reused asset');
    } finally {
      releaseGc();
      fsp.readFile = realReadFile;
      fsp.stat = realStat;
    }

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
