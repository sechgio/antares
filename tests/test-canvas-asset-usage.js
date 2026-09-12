const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  console.log('Testing canvas asset usage accounting...\n');

  const fakeHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-asset-usage-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = fakeHome;

  // `canvas-assets.js` captures `fs.promises` by reference, so patching the
  // object's methods after requiring it still counts the module's calls.
  const fsp = fs.promises;
  const realReaddir = fsp.readdir;
  const realStat = fsp.stat;
  let readdirCalls = 0;
  let statCalls = 0;
  fsp.readdir = async (...args) => {
    readdirCalls += 1;
    return realReaddir.apply(fsp, args);
  };
  fsp.stat = async (...args) => {
    statCalls += 1;
    return realStat.apply(fsp, args);
  };

  try {
    delete require.cache[require.resolve('../electron/canvas-assets.js')];
    const {
      putCanvasAsset,
      assetsDir,
      canvasAssetUsageBytes,
      cachedCanvasAssetUsageBytes,
      gcOrphanCanvasAssets,
      GC_GRACE_MS,
    } = require('../electron/canvas-assets.js');

    const dir = assetsDir();
    const payloads = [];
    for (let i = 0; i < 12; i += 1) {
      payloads.push(Buffer.from(`asset-${i}-${'x'.repeat(i + 1)}`));
    }
    const expectedTotal = payloads.reduce((total, payload) => total + payload.length, 0);

    readdirCalls = 0;
    statCalls = 0;
    const results = [];
    for (const payload of payloads) {
      results.push(await putCanvasAsset(payload));
    }

    assert.strictEqual(
      readdirCalls,
      1,
      `writing N assets must scan the directory at most once (got ${readdirCalls} scans for ${payloads.length} writes)`,
    );
    assert.strictEqual(
      statCalls,
      payloads.length,
      `writing N assets must stat once per write (got ${statCalls} for ${payloads.length} writes)`,
    );

    readdirCalls = 0;
    statCalls = 0;
    await putCanvasAsset(payloads[0]);
    assert.strictEqual(readdirCalls, 0, 'a dedupe write must not scan the directory');
    assert.strictEqual(statCalls, 1, 'a dedupe write stats the target only');

    assert.strictEqual(await canvasAssetUsageBytes(), expectedTotal, 'disk usage matches the payloads');
    assert.strictEqual(
      cachedCanvasAssetUsageBytes(),
      expectedTotal,
      'the incremental counter tracks the payloads',
    );

    // Files created outside the module make the counter stale; GC is the
    // reconciliation point and must bring it back in line with the directory.
    const strayBytes = 32;
    await fs.promises.writeFile(path.join(dir, 'f'.repeat(64)), Buffer.alloc(strayBytes, 1));
    // Legacy/non-64-hex asset names (32-128 hex) count toward the quota too.
    const legacyBytes = 24;
    await fs.promises.writeFile(path.join(dir, 'a'.repeat(32)), Buffer.alloc(legacyBytes, 1));
    assert.strictEqual(
      await canvasAssetUsageBytes(),
      expectedTotal + strayBytes + legacyBytes,
      'the full scan counts non-64-hex asset names',
    );
    await fs.promises.rm(path.join(dir, 'a'.repeat(32)));
    assert.strictEqual(
      cachedCanvasAssetUsageBytes(),
      expectedTotal,
      'counter is not recomputed on every read',
    );
    assert.strictEqual(
      await canvasAssetUsageBytes(),
      expectedTotal + strayBytes,
      'the full scan sees the stray file',
    );

    await gcOrphanCanvasAssets({ nowMs: Date.now(), graceMs: GC_GRACE_MS });
    assert.strictEqual(
      cachedCanvasAssetUsageBytes(),
      await canvasAssetUsageBytes(),
      'GC reconciles the cached total with the directory',
    );

    // Replacing a corrupted asset must keep the counter consistent.
    const victim = results[3];
    const victimPath = path.join(dir, victim.asset_id);
    await fs.promises.writeFile(victimPath, 'tiny');
    const repaired = await putCanvasAsset(payloads[3]);
    assert.strictEqual(repaired.asset_id, victim.asset_id, 'the same bytes map to the same asset id');
    assert.strictEqual(
      cachedCanvasAssetUsageBytes(),
      await canvasAssetUsageBytes(),
      'replacing an asset keeps the counter consistent',
    );

    console.log('  ✓ single scan for N writes, dedupe stays scan-free, GC reconciles');
    console.log('\nAll canvas-asset-usage tests passed.');
  } finally {
    fsp.readdir = realReaddir;
    fsp.stat = realStat;
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    await fs.promises.rm(fakeHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
