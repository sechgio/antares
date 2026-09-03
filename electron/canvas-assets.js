const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const ASSET_REF_PREFIX = 'canvas-asset:';
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

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
  await fsp.mkdir(assetsDir(), { recursive: true });
  try {
    const handle = await fsp.open(dest, 'wx');
    try {
      await handle.writeFile(buf);
    } finally {
      await handle.close();
    }
  } catch (e) {
    if (e && e.code !== 'EEXIST') throw e;
  }
  return { asset_id: assetId, ref: toAssetRef(assetId), bytes: buf.length };
}

async function getCanvasAsset(assetIdOrRef) {
  const id = parseAssetRef(assetIdOrRef) || assetIdOrRef;
  const dest = assetPath(id);
  const buf = await fsp.readFile(dest);
  if (buf.length > MAX_ASSET_BYTES) throw new Error('canvas asset too large');
  return buf;
}

const ASSET_REF_SCAN_RE = /canvas-asset:([a-f0-9]{32,128})/gi;
const GC_GRACE_MS = 60 * 60 * 1000;

function canvasDocsAndHistoryDirs() {
  const base = _antaresUserData('canvas');
  return [path.join(base, 'documents'), path.join(base, 'history')];
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
  const dir = assetsDir();
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { removed: 0, kept: referenced.size, skippedGrace: 0 };
  }

  let removed = 0;
  let skippedGrace = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const id = ent.name.toLowerCase();
    if (!/^[a-f0-9]{32,128}$/.test(id)) continue;
    if (referenced.has(id)) continue;
    const full = path.join(dir, ent.name);
    try {
      const st = await fsp.stat(full);
      if (nowMs - st.mtimeMs < graceMs) {
        skippedGrace += 1;
        continue;
      }
      await fsp.rm(full, { force: true });
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return { removed, kept: referenced.size, skippedGrace };
}

module.exports = {
  ASSET_REF_PREFIX,
  MAX_ASSET_BYTES,
  GC_GRACE_MS,
  assetsDir,
  assetPath,
  parseAssetRef,
  toAssetRef,
  putCanvasAsset,
  getCanvasAsset,
  collectReferencedAssetIds,
  gcOrphanCanvasAssets,
  canvasDocsAndHistoryDirs,
};
