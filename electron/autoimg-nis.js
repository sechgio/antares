const NIS_REGEX = /\b(\d{7})\b/;

function extractNis(filename) {
  const match = NIS_REGEX.exec(filename);
  return match ? match[1] : null;
}

function buildNisMap(files, folderName) {
  const nisMap = {};
  for (const file of files) {
    const nis = extractNis(file.name);
    if (!nis) continue;
    if (!nisMap[nis]) {
      nisMap[nis] = { count: 0, files: [], folders: [] };
    }
    nisMap[nis].count += 1;
    nisMap[nis].files.push({ name: file.name, id: file.id, modifiedTime: file.modifiedTime });
    if (folderName && !nisMap[nis].folders.includes(folderName)) {
      nisMap[nis].folders.push(folderName);
    }
  }
  return nisMap;
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
        merged[nis] = { count: 0, files: [], folders: [] };
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
    }
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
  NIS_REGEX,
  extractNis,
  buildNisMap,
  parseDedupStrategy,
  mergeNisMaps,
  computeEstado,
  computeImgFlags,
};