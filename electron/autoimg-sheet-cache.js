const sheets = require('./google-sheets-service');
const drive = require('./google-drive-service');

const CACHE_TTL_MS = 60_000;
const SHEET_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
const SHEET_CACHE_BLOCKS = Object.freeze(['bdImg', 'logs', 'arrastre', 'folders']);

// Estado mutable del caché en un solo objeto: permite que otros módulos lean
// los bloques sin getters y que este módulo reasigne sin perder la referencia.
const sheetCache = {
  sheetId: null,
  bdImg: [],
  logs: [],
  arrastre: [],
  folders: [],
  blocks: {
    bdImg: { loadedAt: 0, revision: null },
    logs: { loadedAt: 0, revision: null },
    arrastre: { loadedAt: 0, revision: null },
    folders: { loadedAt: 0, revision: null },
  },
  budgetOverride: null,
};

function estimateSheetPayloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function sheetCacheBudgetBytes() {
  return sheetCache.budgetOverride == null ? SHEET_CACHE_BUDGET_BYTES : sheetCache.budgetOverride;
}

function normalizeCacheBlocks(blocks = SHEET_CACHE_BLOCKS) {
  return blocks.filter((block) => Object.prototype.hasOwnProperty.call(sheetCache.blocks, block));
}

function invalidateCache(blocks = SHEET_CACHE_BLOCKS) {
  for (const block of normalizeCacheBlocks(blocks)) {
    sheetCache.blocks[block].loadedAt = 0;
    sheetCache.blocks[block].revision = null;
  }
}

function clearSheetCaches() {
  sheetCache.sheetId = null;
  sheetCache.bdImg = [];
  sheetCache.logs = [];
  sheetCache.arrastre = [];
  sheetCache.folders = [];
  invalidateCache();
}

function isCacheFresh(blocks = SHEET_CACHE_BLOCKS) {
  if (sheetCache.sheetId !== (sheets.getSheetId?.() || null)) {
    clearSheetCaches();
    return false;
  }
  const now = Date.now();
  return normalizeCacheBlocks(blocks).every((block) => {
    const loadedAt = sheetCache.blocks[block].loadedAt;
    return loadedAt > 0 && now - loadedAt < CACHE_TTL_MS;
  });
}

function touchCache(blocks = SHEET_CACHE_BLOCKS) {
  const loadedAt = Date.now();
  for (const block of normalizeCacheBlocks(blocks)) {
    sheetCache.blocks[block].loadedAt = loadedAt;
  }
}

function tryCommitSheetCache(partial = {}) {
  const next = {
    bdImg: Object.prototype.hasOwnProperty.call(partial, 'bdImg') ? partial.bdImg : sheetCache.bdImg,
    logs: Object.prototype.hasOwnProperty.call(partial, 'logs') ? partial.logs : sheetCache.logs,
    arrastre: Object.prototype.hasOwnProperty.call(partial, 'arrastre')
      ? partial.arrastre
      : sheetCache.arrastre,
    folders: Object.prototype.hasOwnProperty.call(partial, 'folders')
      ? partial.folders
      : sheetCache.folders,
  };
  const bytes = estimateSheetPayloadBytes(next);
  if (bytes > sheetCacheBudgetBytes()) {
    clearSheetCaches();
    return false;
  }
  sheetCache.sheetId = sheets.getSheetId?.() || null;
  sheetCache.bdImg = next.bdImg;
  sheetCache.logs = next.logs;
  sheetCache.arrastre = next.arrastre;
  sheetCache.folders = next.folders;
  return true;
}

async function readSheetRevision() {
  try {
    const sheetId = sheets.getSheetId?.();
    if (!sheetId || typeof drive.getFileMetadata !== 'function') return null;
    const meta = await drive.getFileMetadata(sheetId, 'modifiedTime,version');
    return meta?.modifiedTime || (meta?.version != null ? String(meta.version) : null);
  } catch {
    return null;
  }
}

async function canServeUnchangedRevision(blocks = SHEET_CACHE_BLOCKS, knownRevision = null) {
  if (sheetCache.sheetId !== (sheets.getSheetId?.() || null)) {
    clearSheetCaches();
    return false;
  }
  const requested = normalizeCacheBlocks(blocks);
  if (!requested.length) return false;
  if (!requested.every((block) => {
    const state = sheetCache.blocks[block];
    return state.loadedAt > 0 && state.revision;
  })) return false;
  const rev = knownRevision || await readSheetRevision();
  return Boolean(rev && requested.every((block) => sheetCache.blocks[block].revision === rev));
}

async function rememberSheetRevision(knownRev, blocks = SHEET_CACHE_BLOCKS) {
  const requested = normalizeCacheBlocks(blocks);
  if (!requested.length) return;
  const revision = knownRev || await readSheetRevision();
  if (revision) {
    for (const block of requested) sheetCache.blocks[block].revision = revision;
  }
}

function inspectSheetCache() {
  const loadedAtByBlock = Object.fromEntries(
    SHEET_CACHE_BLOCKS.map((block) => [block, sheetCache.blocks[block].loadedAt]),
  );
  const revisionByBlock = Object.fromEntries(
    SHEET_CACHE_BLOCKS.map((block) => [block, sheetCache.blocks[block].revision]),
  );
  const revisions = [...new Set(Object.values(revisionByBlock).filter(Boolean))];
  return {
    bdImgLen: sheetCache.bdImg.length,
    logsLen: sheetCache.logs.length,
    arrastreLen: sheetCache.arrastre.length,
    foldersLen: sheetCache.folders.length,
    loadedAt: Math.max(...Object.values(loadedAtByBlock)),
    revision: revisions.length === 1 ? revisions[0] : null,
    loadedAtByBlock,
    revisionByBlock,
    approxBytes: estimateSheetPayloadBytes({
      bdImg: sheetCache.bdImg,
      logs: sheetCache.logs,
      arrastre: sheetCache.arrastre,
      folders: sheetCache.folders,
    }),
  };
}

function setSheetCacheBudget(bytes) {
  sheetCache.budgetOverride = bytes == null ? null : Number(bytes);
}

function resetSheetCache() {
  clearSheetCaches();
  sheetCache.budgetOverride = null;
}

module.exports = {
  CACHE_TTL_MS,
  SHEET_CACHE_BUDGET_BYTES,
  SHEET_CACHE_BLOCKS,
  sheetCache,
  isCacheFresh,
  touchCache,
  invalidateCache,
  clearSheetCaches,
  tryCommitSheetCache,
  readSheetRevision,
  canServeUnchangedRevision,
  rememberSheetRevision,
  inspectSheetCache,
  setSheetCacheBudget,
  resetSheetCache,
};
