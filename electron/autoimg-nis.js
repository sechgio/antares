/**
 * AutoIMG image naming (NIS = 7 digits):
 *   6553447_1.jpg | 6553447_2.jpeg | 6553447_3.png
 *   6553447-1.jpg | 6553447-2 | 6553447-3
 *   6553447-1A.jpg | 6553447-2B | 6553447-3C
 *
 * Note: JS \b treats "_" as a word char, so /\b(\d{7})\b/ fails on 6553447_1.jpg.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif)$/i;

/** Basename must start with 7 digits; optional slot suffix after _ or - */
const NIS_FILE_RE = /^(\d{7})(?:[_-][A-Za-z0-9]+)*$/;

/** Preferred slot form: _1 / -2 / -3A (letter optional) */
const NIS_SLOT_RE = /^(\d{7})[_-]([1-9]\d*)([A-Za-z])?$/i;

function stripExtension(filename) {
  const name = String(filename || '').trim();
  if (!name) return '';
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return name;
  return name.slice(0, lastDot);
}

/**
 * Extract the 7-digit NIS from a Drive image filename.
 * Returns null if the name does not follow the AutoIMG convention.
 */
function extractNis(filename) {
  const base = stripExtension(filename);
  if (!base) return null;

  // Primary: starts with 7 digits + optional _/- suffix(es)
  const primary = base.match(NIS_FILE_RE);
  if (primary) return primary[1];

  // Fallback: 7 digits at start before _ or - (lenient if extra trailing junk)
  const loose = base.match(/^(\d{7})(?=[_-]|$)/);
  if (loose) return loose[1];

  // Fallback: 7 digits not part of a longer number, not using \b (underscore-safe)
  const mid = base.match(/(?:^|[^\d])(\d{7})(?=[_\-.\s]|$|[^\d])/);
  return mid ? mid[1] : null;
}

/**
 * Slot number (1–3 typically) if the name ends with _N or -N[optional letter].
 * e.g. 6553447_1 → 1, 6553447-3C → 3
 */
function extractSlot(filename) {
  const base = stripExtension(filename);
  const m = base.match(NIS_SLOT_RE);
  if (!m) return null;
  return Number(m[2]);
}

/**
 * Merge one page of Drive files into an accumulating NIS map (slots stay as Set).
 * Call finalizeNisMap before IPC / JSON serialization.
 */
function accumulateNisFiles(nisMap, files, folderName) {
  const map = nisMap || {};
  for (const file of files || []) {
    const name = file.name || '';
    const nis = extractNis(name);
    if (!nis) continue;
    if (!map[nis]) {
      map[nis] = { count: 0, files: [], folders: [], slots: new Set() };
    } else if (!(map[nis].slots instanceof Set)) {
      map[nis].slots = new Set(map[nis].slots || []);
    }
    map[nis].count += 1;
    map[nis].files.push({
      name,
      id: file.id,
      modifiedTime: file.modifiedTime,
      slot: extractSlot(name),
    });
    const slot = extractSlot(name);
    if (slot != null) map[nis].slots.add(slot);
    if (folderName && !map[nis].folders.includes(folderName)) {
      map[nis].folders.push(folderName);
    }
  }
  return map;
}

/** Convert slot Sets to sorted arrays for IPC. Mutates and returns nisMap. */
function finalizeNisMap(nisMap) {
  for (const entry of Object.values(nisMap || {})) {
    const slots = entry.slots instanceof Set ? entry.slots : entry.slots || [];
    entry.slots = [...slots].sort((a, b) => a - b);
  }
  return nisMap || {};
}

function buildNisMap(files, folderName) {
  return finalizeNisMap(accumulateNisFiles({}, files, folderName));
}

function parseDedupStrategy(value) {
  return String(value || '').trim().toUpperCase() === 'MAX' ? 'MAX' : 'SUM';
}

function mergeNisMaps(maps, strategy = 'SUM') {
  const mode = parseDedupStrategy(strategy);
  const merged = {};
  for (const map of maps) {
    for (const [nis, entry] of Object.entries(map)) {
      if (!merged[nis]) {
        merged[nis] = { count: 0, files: [], folders: [], slots: new Set() };
      }
      if (mode === 'MAX') {
        merged[nis].count = Math.max(merged[nis].count, entry.count);
      } else {
        merged[nis].count += entry.count;
      }
      merged[nis].files.push(...entry.files);
      for (const folder of entry.folders) {
        if (!merged[nis].folders.includes(folder)) merged[nis].folders.push(folder);
      }
      const slots = entry.slots instanceof Set ? entry.slots : entry.slots || [];
      for (const s of slots) merged[nis].slots.add(s);
    }
  }
  for (const entry of Object.values(merged)) {
    entry.slots = [...entry.slots].sort((a, b) => a - b);
  }
  return merged;
}

function computeEstado(cantidad) {
  if (cantidad === 3) return '🟢 COMPLETO';
  if (cantidad < 3) return '🔴 FALTANTE';
  return '🟡 SOBRANTE';
}

function computeImgFlags(cantidad) {
  return [
    cantidad >= 1 ? '✅' : '⬜',
    cantidad >= 2 ? '✅' : '⬜',
    cantidad >= 3 ? '✅' : '⬜',
  ];
}

module.exports = {
  NIS_FILE_RE,
  NIS_SLOT_RE,
  IMAGE_EXT_RE,
  stripExtension,
  extractNis,
  extractSlot,
  accumulateNisFiles,
  finalizeNisMap,
  buildNisMap,
  parseDedupStrategy,
  mergeNisMaps,
  computeEstado,
  computeImgFlags,
};
