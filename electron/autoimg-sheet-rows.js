const { computeEstado, computeImgFlags } = require('./autoimg-nis');

const BD_IMG_HEADER = [
  'NIS', 'SGIO', 'DESTINO', 'NOMBRE', 'DIRECCION',
  'IMG_1', 'IMG_2', 'IMG_3', 'CANTIDAD', 'ESTADO',
  'ORIGEN_CARPETAS', 'ULTIMA_VERIFICACION', 'NOTAS',
];

const AUTOIMG_SHEET_TABS = {
  BD_IMG: BD_IMG_HEADER,
  FOLDERS: ['NOMBRE', 'FOLDER_ID', 'ACTIVO', 'ULTIMO_SCAN', 'CANT_ARCHIVOS'],
  BD_ARRASTRE: ['NIS', 'SGIO', 'MOTIVO', 'FECHA', 'OBSERVACION'],
  LOGS: ['FECHA', 'ACCION', 'DETALLE', 'USUARIO', 'DURACION'],
  CONFIG: ['Clave', 'Valor'],
  RESUMEN: ['METRICA', 'VALOR', 'FECHA'],
};

function listMissingAutoImgTabs(existingTabNames) {
  const existing = new Set((existingTabNames || []).map((name) => String(name || '').trim()));
  return Object.keys(AUTOIMG_SHEET_TABS).filter((tab) => !existing.has(tab));
}

/**
 * NOTAS en sync: el padrón no se amplía desde el escaneo, así que siempre
 * se conservan las notas existentes de la fila.
 */
function resolveNotasForSync({ existingNotas }) {
  return existingNotas || '';
}

function _bdImgHasHeader(rows) {
  return rows.length > 0 && String(rows[0]?.[0] || '').trim().toUpperCase() === 'NIS';
}

function _bdImgStartIndex(rows) {
  return _bdImgHasHeader(rows) ? 1 : 0;
}

function _bdImgDataRows(rows) {
  return _bdImgHasHeader(rows) ? rows.slice(1) : rows;
}

function countSinSgioRows(rows) {
  return _bdImgDataRows(rows).filter((row) => !String(row[1] || '').trim()).length;
}

/** Deriva métricas RESUMEN desde filas BD_IMG mergeadas (col CANTIDAD = índice 8). */
function countBdImgEstadoMetrics(rows) {
  const dataRows = _bdImgDataRows(rows);
  let completos = 0;
  let faltantes = 0;
  let sobrantes = 0;
  for (const row of dataRows) {
    const count = Number(row[8]) || 0;
    if (count === 3) completos += 1;
    else if (count < 3) faltantes += 1;
    else sobrantes += 1;
  }
  return {
    totalNis: dataRows.length,
    completos,
    faltantes,
    sobrantes,
  };
}

/**
 * NIS del escaneo ausentes en el padrón BD_IMG (fuera del padrón).
 * No confundir con countSinSgioRows (filas del padrón sin SGIO en col B).
 */
function countScanFueraPadron(nisList, existingNisSet) {
  return nisList.filter((nis) => !existingNisSet.has(nis)).length;
}

/** @deprecated Use countScanFueraPadron — nombre histórico ambiguo. */
function countScanSinSgio(nisList, existingNisSet) {
  return countScanFueraPadron(nisList, existingNisSet);
}

function findNisRowIndex(values, nis) {
  const start = _bdImgStartIndex(values);
  for (let i = start; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === nis) return i;
  }
  return -1;
}

/** Map NIS → último índice de fila (compat). Preferir buildNisRowIndexesMap. */
function buildNisRowIndexMap(values) {
  const map = new Map();
  const start = _bdImgStartIndex(values);
  for (let i = start; i < values.length; i++) {
    const nis = String(values[i][0] || '').trim();
    if (nis) map.set(nis, i);
  }
  return map;
}

/** Map NIS → todos los índices de fila (soporta duplicados en el padrón). */
function buildNisRowIndexesMap(values) {
  const map = new Map();
  const start = _bdImgStartIndex(values);
  for (let i = start; i < values.length; i++) {
    const nis = String(values[i][0] || '').trim();
    if (!nis) continue;
    const list = map.get(nis);
    if (list) list.push(i);
    else map.set(nis, [i]);
  }
  return map;
}

function _rowSignature(row) {
  return JSON.stringify(row || []);
}

/**
 * Fusiona el escaneo con el padrón BD_IMG.
 * BD_IMG es la fuente de verdad: solo se actualizan filas cuyo NIS ya está
 * en la hoja. NIS detectados en carpetas pero ausentes del padrón se ignoran
 * (no se insertan filas nuevas). Filas del padrón sin imágenes en el escaneo
 * quedan con CANTIDAD 0 y ESTADO FALTANTE. NIS duplicados: se actualizan todas.
 */
function applyScanResultsToRows(rows, nisResults, verification) {
  const nextRows = rows.length ? [...rows] : [BD_IMG_HEADER];
  const nisIndexes = buildNisRowIndexesMap(nextRows);
  const scanByNis = new Map();
  for (const result of nisResults) {
    const nis = String(result?.nis || '').trim();
    if (nis) scanByNis.set(nis, result);
  }

  let updated = 0;
  let matched = 0;
  let notFound = 0;
  let duplicateNis = 0;

  for (const [nis, idxs] of nisIndexes) {
    const result = scanByNis.get(nis) || { nis, count: 0, folders: [] };
    if (idxs.length > 1) duplicateNis += 1;
    for (const idx of idxs) {
      const before = _rowSignature(nextRows[idx]);
      nextRows[idx] = buildScanResultRow({
        scanResult: result,
        rows: nextRows,
        verification,
        rowIndex: idx,
      });
      if (before !== _rowSignature(nextRows[idx])) updated += 1;
    }
    if (scanByNis.has(nis)) matched += 1;
    else notFound += 1;
  }

  let unmatchedScan = 0;
  for (const nis of scanByNis.keys()) {
    if (!nisIndexes.has(nis)) unmatchedScan += 1;
  }

  // newRows siempre 0: el padrón no se amplía desde el escaneo
  return {
    rows: nextRows,
    updated,
    newRows: 0,
    matched,
    notFound,
    unmatchedScan,
    duplicateNis,
  };
}

function buildScanResultRow({ scanResult, rows, verification, rowIndex }) {
  const idx = rowIndex ?? findNisRowIndex(rows, scanResult.nis);
  const [img1, img2, img3] = computeImgFlags(scanResult.count);
  const existing = idx >= 0 ? rows[idx] : null;
  const sgio = existing ? (existing[1] || '') : '';
  return [
    scanResult.nis,
    sgio,
    existing ? (existing[2] || '') : '',
    existing ? (existing[3] || '') : '',
    existing ? (existing[4] || '') : '',
    img1,
    img2,
    img3,
    String(scanResult.count),
    computeEstado(scanResult.count),
    (scanResult.folders || []).join('; '),
    verification,
    resolveNotasForSync({
      existingNotas: existing ? (existing[12] || '') : '',
    }),
  ];
}

function parseArrastreRows(values) {
  if (!values?.length) return [];
  const start = String(values[0]?.[0] || '').toUpperCase() === 'NIS' ? 1 : 0;
  const entries = [];
  for (let i = start; i < values.length; i++) {
    const row = values[i];
    const nis = String(row[0] || '').trim();
    if (!nis) continue;
    entries.push({
      nis,
      sgio: row[1] || '',
      motivo: row[2] || '',
      fecha: row[3] || '',
      observacion: row[4] || '',
    });
  }
  return entries;
}

function parseActivo(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === '✅' || v === 'SI' || v === 'TRUE' || v === '1' || v === 'ACTIVO';
}

function parseFoldersFromValues(values) {
  if (!values?.length) return [];
  const folders = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[1]) continue;
    folders.push({
      name: row[0] || '',
      folder_id: row[1] || '',
      activo: parseActivo(row[2]),
      ultimo_scan: row[3] || '',
      cant_archivos: Number(row[4]) || 0,
    });
  }
  return folders;
}

function parseResumenMetrics(values) {
  const metrics = {};
  for (const row of values || []) {
    const metricKey = String(row[0] || '');
    if (metricKey === 'TOTAL NIS') metrics.totalNis = Number(row[1]) || 0;
    if (metricKey.includes('COMPLETOS')) metrics.completos = Number(row[1]) || 0;
    if (metricKey.includes('FALTANTES')) metrics.faltantes = Number(row[1]) || 0;
    if (metricKey.includes('SOBRANTES')) metrics.sobrantes = Number(row[1]) || 0;
    if (metricKey.includes('SIN SGIO')) metrics.sinSgio = Number(row[1]) || 0;
  }
  return metrics;
}

function configValueFromRows(values, key) {
  for (let i = 1; i < (values || []).length; i++) {
    if (String(values[i][0] || '').trim().toUpperCase() === key.toUpperCase()) {
      return values[i][1] || '';
    }
  }
  return '';
}

function countActiveFolders(values) {
  let count = 0;
  for (let i = 1; i < (values || []).length; i++) {
    if (parseActivo(values[i][2])) count += 1;
  }
  return count;
}

module.exports = {
  BD_IMG_HEADER,
  AUTOIMG_SHEET_TABS,
  listMissingAutoImgTabs,
  resolveNotasForSync,
  countSinSgioRows,
  countBdImgEstadoMetrics,
  countScanFueraPadron,
  countScanSinSgio,
  findNisRowIndex,
  buildNisRowIndexMap,
  buildNisRowIndexesMap,
  applyScanResultsToRows,
  buildScanResultRow,
  parseArrastreRows,
  parseActivo,
  parseFoldersFromValues,
  parseResumenMetrics,
  configValueFromRows,
  countActiveFolders,
};
