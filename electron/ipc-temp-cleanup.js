/**
 * Sweep ephemeral IPC temp dirs (PDF auto-out, spreadsheet spill JSON).
 * Files older than MAX_AGE_MS are deleted; best-effort, never throws to callers.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_DIR_NAMES = ['antares-pdf-out', 'antares-spreadsheet-results'];

function ipcTempDirs() {
  return TEMP_DIR_NAMES.map((name) => path.join(os.tmpdir(), name));
}

function isUnderDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(dir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Delete a spreadsheet spill JSON after a successful read (when under our temp dir).
 */
async function cleanupSpreadsheetSpillFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return;
  const spillRoot = path.join(os.tmpdir(), 'antares-spreadsheet-results');
  if (!isUnderDir(filePath, spillRoot)) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
}

/**
 * Remove files (not dirs) older than MAX_AGE_MS from IPC temp folders.
 * @returns {Promise<number>} number of files removed
 */
async function sweepIpcTempDirs(nowMs = Date.now()) {
  let removed = 0;
  for (const dir of ipcTempDirs()) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const full = path.join(dir, ent.name);
      try {
        const st = await fsp.stat(full);
        if (nowMs - st.mtimeMs >= MAX_AGE_MS) {
          await fsp.rm(full, { force: true });
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }
  // Opportunistic orphan canvas-asset GC (best-effort; never throws).
  try {
    const { gcOrphanCanvasAssets } = require('./canvas-assets');
    await gcOrphanCanvasAssets({ nowMs });
  } catch {
    /* optional */
  }
  return removed;
}

module.exports = {
  MAX_AGE_MS,
  ipcTempDirs,
  cleanupSpreadsheetSpillFile,
  sweepIpcTempDirs,
  isUnderDir,
};
