const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const ASSET_REF_PREFIX = 'canvas-asset:';
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_CANVAS_ASSET_TOTAL_BYTES = 512 * 1024 * 1024;
// Serialize quota checks and buffer at most one active and one pending asset.
const MAX_PENDING_ASSET_WRITE_BYTES = MAX_ASSET_BYTES * 2;

function _antaresUserData(...parts) {
  let base;
  if (process.platform === 'win32') {
    base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Antares');
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', 'Antares');
  } else {
    base = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Antares');
  }
  return path.join(base, ...parts);
}

function assetsDir() {
  return _antaresUserData('canvas', 'assets');
}

function assetPath(assetId) {
  if (typeof assetId !== 'string' || !/^[a-f0-9]{32,128}$/i.test(assetId)) {
    throw new Error('invalid canvas asset id');
  }
  return path.join(assetsDir(), assetId);
}

function parseAssetRef(value) {
  if (typeof value !== 'string' || !value.startsWith(ASSET_REF_PREFIX)) return null;
  return value.slice(ASSET_REF_PREFIX.length);
}

function toAssetRef(assetId) {
  return `${ASSET_REF_PREFIX}${assetId}`;
}

// An asset written by putCanvasAsset is not referenced by any persisted
// document until the next save; a pending marker keeps GC from collecting it
// during that window (which survives restarts, unlike the mtime grace).
const PENDING_ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_ASSET_MARKERS = 512;

function pendingAssetsPath() {
  return _antaresUserData('canvas', 'spill', 'pending-assets.json');
}

async function readPendingAssets() {
  try {
    const parsed = JSON.parse(await fsp.readFile(pendingAssetsPath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.id === 'string' && /^[a-f0-9]{32,128}$/i.test(e.id)
        && typeof e.at === 'number' && Number.isFinite(e.at),
    );
  } catch {
    return [];
  }
}

async function writePendingAssets(entries) {
  const p = pendingAssetsPath();
  if (entries.length === 0) {
    await fsp.rm(p, { force: true }).catch(() => {});
    return;
  }
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(entries), 'utf8');
  await fsp.rename(tmp, p);
}

async function markAssetPending(assetId) {
  try {
    const entries = (await readPendingAssets()).filter((e) => e.id !== assetId);
    entries.push({ id: assetId, at: Date.now() });
    await writePendingAssets(entries.slice(-MAX_PENDING_ASSET_MARKERS));
  } catch {
    // A failed marker only weakens GC protection for this asset — never break put.
  }
}

let assetWriteChain = Promise.resolve();
let pendingAssetWriteBytes = 0;

function withAssetWriteLock(work, queuedBytes) {
  if (pendingAssetWriteBytes + queuedBytes > MAX_PENDING_ASSET_WRITE_BYTES) {
    throw new Error(
      `canvas asset write backpressure limit exceeded (${pendingAssetWriteBytes + queuedBytes} > ${MAX_PENDING_ASSET_WRITE_BYTES})`,
    );
  }
  pendingAssetWriteBytes += queuedBytes;
  const next = assetWriteChain.then(work);
  assetWriteChain = next.catch(() => {});
  return next.finally(() => {
    pendingAssetWriteBytes = Math.max(0, pendingAssetWriteBytes - queuedBytes);
  });
}

async function canvasAssetUsageBytes() {
  let entries;
  try {
    entries = await fsp.readdir(assetsDir(), { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const ent of entries) {
    if (!ent.isFile() || !/^[a-f0-9]{32,128}$/i.test(ent.name)) continue;
    try {
      total += (await fsp.stat(path.join(assetsDir(), ent.name))).size;
    } catch {
    }
  }
  return total;
}

// Writes apply deltas. Garbage collection recalculates the total from disk.
let cachedAssetUsageBytes = null;
const MAX_VERIFIED_ASSET_CACHE_ENTRIES = 512;
const verifiedAssetStatKeys = new Map();

function assetStatKey(stat) {
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function rememberVerifiedAsset(assetId, stat) {
  verifiedAssetStatKeys.delete(assetId);
  verifiedAssetStatKeys.set(assetId, assetStatKey(stat));
  while (verifiedAssetStatKeys.size > MAX_VERIFIED_ASSET_CACHE_ENTRIES) {
    verifiedAssetStatKeys.delete(verifiedAssetStatKeys.keys().next().value);
  }
}

function invalidateVerifiedAsset(assetId) {
  verifiedAssetStatKeys.delete(assetId);
}

async function readAssetUsageBytes() {
  if (cachedAssetUsageBytes === null) {
    cachedAssetUsageBytes = await canvasAssetUsageBytes();
  }
  return cachedAssetUsageBytes;
}

function adjustAssetUsageBytes(delta) {
  if (cachedAssetUsageBytes === null) return;
  cachedAssetUsageBytes = Math.max(0, cachedAssetUsageBytes + delta);
}

async function reconcileAssetUsageBytes() {
  cachedAssetUsageBytes = await canvasAssetUsageBytes();
  return cachedAssetUsageBytes;
}

function cachedCanvasAssetUsageBytes() {
  return cachedAssetUsageBytes;
}

async function putCanvasAsset(bytes) {
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof ArrayBuffer
      ? Buffer.from(bytes)
      : ArrayBuffer.isView(bytes)
        ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : null;
  if (!buf || buf.length === 0) throw new Error('empty asset');
  if (buf.length > MAX_ASSET_BYTES) throw new Error('canvas asset too large');

  const assetId = crypto.createHash('sha256').update(buf).digest('hex');
  const dest = assetPath(assetId);
  return withAssetWriteLock(async () => {
    await fsp.mkdir(assetsDir(), { recursive: true });
    let replacedBytes = 0;
    try {
      const existingStat = await fsp.stat(dest);
      if (existingStat.isFile() && existingStat.size === buf.length) {
        const existing = await fsp.readFile(dest);
        const existingHash = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingHash === assetId) {
          await markAssetPending(assetId);
          return { asset_id: assetId, ref: toAssetRef(assetId), bytes: buf.length };
        }
      }
      if (existingStat.isFile()) replacedBytes = existingStat.size;
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }

    const currentBytes = await readAssetUsageBytes();
    const projectedBytes = currentBytes - replacedBytes + buf.length;
    if (projectedBytes > MAX_CANVAS_ASSET_TOTAL_BYTES) {
      throw new Error(
        `canvas asset storage limit exceeded (${projectedBytes} > ${MAX_CANVAS_ASSET_TOTAL_BYTES})`,
      );
    }

    if (replacedBytes > 0) {
      // A mismatched content-addressed file invalidates the cached total.
      await fsp.rm(dest, { force: true });
      invalidateVerifiedAsset(assetId);
      await reconcileAssetUsageBytes();
    }
    invalidateVerifiedAsset(assetId);

    const temp = path.join(
      assetsDir(),
      `.${assetId}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );
    let handle;
    try {
      handle = await fsp.open(temp, 'wx');
      await handle.writeFile(buf);
      await handle.sync();
      await handle.close();
      handle = null;

      try {
        await fsp.access(dest, fs.constants.F_OK);
        await fsp.rm(temp, { force: true });
      } catch {
        await fsp.rename(temp, dest);
        adjustAssetUsageBytes(buf.length);
      }
    } catch (e) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw e;
    }
    await markAssetPending(assetId);
    return { asset_id: assetId, ref: toAssetRef(assetId), bytes: buf.length };
  }, buf.length);
}

async function getCanvasAsset(assetIdOrRef) {
  const id = parseAssetRef(assetIdOrRef) || assetIdOrRef;
  const dest = assetPath(id);
  const isContentAddressed = /^[a-f0-9]{64}$/i.test(id);
  const beforeStat = isContentAddressed ? await fsp.stat(dest) : null;
  if (beforeStat && beforeStat.size > MAX_ASSET_BYTES) throw new Error('canvas asset too large');
  const buf = await fsp.readFile(dest);
  if (buf.length > MAX_ASSET_BYTES) throw new Error('canvas asset too large');
  if (isContentAddressed) {
    const afterStat = await fsp.stat(dest);
    const stable = beforeStat && assetStatKey(beforeStat) === assetStatKey(afterStat);
    const cacheKey = assetStatKey(afterStat);
    const cachedKey = verifiedAssetStatKeys.get(id.toLowerCase());
    if (stable && buf.length === afterStat.size && cachedKey === cacheKey) return buf;

    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== id.toLowerCase()) {
      invalidateVerifiedAsset(id.toLowerCase());
      throw new Error('canvas asset checksum mismatch');
    }
    if (stable && buf.length === afterStat.size) rememberVerifiedAsset(id.toLowerCase(), afterStat);
  }
  return buf;
}

async function getCanvasAssetInfo(assetIdOrRef) {
  const id = parseAssetRef(assetIdOrRef) || assetIdOrRef;
  const dest = assetPath(id);
  const stat = await fsp.stat(dest);
  if (!stat.isFile()) throw new Error('canvas asset not found');
  if (stat.size > MAX_ASSET_BYTES) throw new Error('canvas asset too large');
  return { asset_id: id, ref: toAssetRef(id), bytes: stat.size };
}

const ASSET_REF_SCAN_RE = /canvas-asset:([a-f0-9]{32,128})/gi;
const GC_GRACE_MS = 60 * 60 * 1000;

function canvasDocsAndHistoryDirs() {
  const base = _antaresUserData('canvas');
  return [path.join(base, 'documents'), path.join(base, 'history'), path.join(base, 'spill')];
}

async function collectReferencedAssetIds(roots = canvasDocsAndHistoryDirs()) {
  const ids = new Set();
  for (const root of roots) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      let text;
      try {
        text = await fsp.readFile(path.join(root, ent.name), 'utf8');
      } catch {
        continue;
      }
      ASSET_REF_SCAN_RE.lastIndex = 0;
      let m;
      while ((m = ASSET_REF_SCAN_RE.exec(text)) !== null) {
        ids.add(m[1].toLowerCase());
      }
    }
  }
  return ids;
}

async function gcOrphanCanvasAssets({ nowMs = Date.now(), graceMs = GC_GRACE_MS } = {}) {
  const referenced = await collectReferencedAssetIds();
  const livePending = [];
  for (const entry of await readPendingAssets()) {
    const id = entry.id.toLowerCase();
    if (referenced.has(id)) continue; // persisted now — the marker did its job
    if (nowMs - entry.at > PENDING_ASSET_TTL_MS) continue; // stale marker
    referenced.add(id);
    livePending.push(entry);
  }
  await writePendingAssets(livePending);
  const dir = assetsDir();
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') cachedAssetUsageBytes = 0;
    return { removed: 0, kept: referenced.size, skippedGrace: 0 };
  }

  let removed = 0;
  let skippedGrace = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const id = ent.name.toLowerCase();
    const full = path.join(dir, ent.name);
    const isTemp = /^\.[a-f0-9]{64}\..+\.tmp$/i.test(ent.name);
    if (!/^[a-f0-9]{32,128}$/.test(id) && !isTemp) continue;
    if (!isTemp && referenced.has(id)) continue;
    try {
      const st = await fsp.stat(full);
      if (nowMs - st.mtimeMs < graceMs) {
        skippedGrace += 1;
        continue;
      }
      await fsp.rm(full, { force: true });
      if (!isTemp) invalidateVerifiedAsset(id);
      removed += 1;
    } catch {
    }
  }

  await reconcileAssetUsageBytes();
  return { removed, kept: referenced.size, skippedGrace };
}

module.exports = {
  ASSET_REF_PREFIX,
  MAX_ASSET_BYTES,
  MAX_CANVAS_ASSET_TOTAL_BYTES,
  MAX_PENDING_ASSET_WRITE_BYTES,
  GC_GRACE_MS,
  PENDING_ASSET_TTL_MS,
  assetsDir,
  assetPath,
  parseAssetRef,
  toAssetRef,
  putCanvasAsset,
  getCanvasAsset,
  getCanvasAssetInfo,
  canvasAssetUsageBytes,
  cachedCanvasAssetUsageBytes,
  collectReferencedAssetIds,
  gcOrphanCanvasAssets,
  canvasDocsAndHistoryDirs,
};
