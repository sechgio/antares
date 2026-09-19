const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const TEMP_DIR_NAMES = ['antares-pdf-out', 'antares-spreadsheet-results'];

function ipcTempDirs() {
  return TEMP_DIR_NAMES.map((name) => path.join(os.tmpdir(), name));
}

function isUnderDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(dir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function cleanupSpreadsheetSpillFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return;
  const spillRoot = path.join(os.tmpdir(), 'antares-spreadsheet-results');
  if (!isUnderDir(filePath, spillRoot)) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
}

async function _sweepIpcTempDirsOnce(nowMs) {
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
      }
    }
  }
  try {
    const { gcOrphanCanvasAssets } = require('./canvas-assets');
    await gcOrphanCanvasAssets({ nowMs });
  } catch {
  }
  return removed;
}

// `sweepIpcTempDirs` also runs the canvas asset GC, which reads and scans every
// canvas document/history/spill JSON. It is called from per-request IPC paths, so
// it self-limits to one full pass per interval instead of one per call.
let _sweepInFlight = null;
let _lastSweepStartedAt = 0;

async function sweepIpcTempDirs(nowMs = Date.now()) {
  if (_sweepInFlight) return _sweepInFlight;
  const startedAt = Date.now();
  if (startedAt - _lastSweepStartedAt < SWEEP_MIN_INTERVAL_MS) return 0;
  _lastSweepStartedAt = startedAt;
  const sweep = _sweepIpcTempDirsOnce(nowMs).finally(() => {
    if (_sweepInFlight === sweep) _sweepInFlight = null;
  });
  _sweepInFlight = sweep;
  return sweep;
}

function resetIpcTempSweepThrottle() {
  _sweepInFlight = null;
  _lastSweepStartedAt = 0;
}

module.exports = {
  MAX_AGE_MS,
  ipcTempDirs,
  cleanupSpreadsheetSpillFile,
  sweepIpcTempDirs,
  resetIpcTempSweepThrottle,
};
