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

function resolveNotasForSync({ isNewRow, existingNotas, sgio }) {
  if (!isNewRow) return existingNotas || '';
  return !String(sgio || '').trim() ? 'NUEVO (sin SGIO)' : '';
}

function _bdImgDataRows(rows) {
  return rows.length > 1 && String(rows[0]?.[0] || '').toUpperCase() === 'NIS'
    ? rows.slice(1)
    : rows;
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

function countScanSinSgio(nisList, existingNisSet) {
  return nisList.filter((nis) => !existingNisSet.has(nis)).length;
}

function findNisRowIndex(values, nis) {
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === nis) return i;
  }
  return -1;
}

function buildNisRowIndexMap(values) {
  const map = new Map();
  for (let i = 1; i < values.length; i++) {
    const nis = String(values[i][0] || '').trim();
    if (nis) map.set(nis, i);
  }
  return map;
}

function applyScanResultsToRows(rows, nisResults, verification) {
  const nextRows = rows.length ? [...rows] : [BD_IMG_HEADER];
  const nisIndex = buildNisRowIndexMap(nextRows);
  let updated = 0;
  let newRows = 0;

  for (const result of nisResults) {
    const idx = nisIndex.get(result.nis) ?? -1;
    const rowData = buildScanResultRow({
      scanResult: result,
      rows: nextRows,
      verification,
      rowIndex: idx,
    });

    if (idx > 0) {
      nextRows[idx] = rowData;
      updated += 1;
    } else {
      nextRows.push(rowData);
      nisIndex.set(result.nis, nextRows.length - 1);
      newRows += 1;
    }
  }

  return { rows: nextRows, updated, newRows };
}

function buildScanResultRow({ scanResult, rows, verification, rowIndex }) {
  const idx = rowIndex ?? findNisRowIndex(rows, scanResult.nis);
  const [img1, img2, img3] = computeImgFlags(scanResult.count);
  const sgio = idx > 0 ? (rows[idx][1] || '') : '';
  return [
    scanResult.nis,
    sgio,
    idx > 0 ? (rows[idx][2] || '') : '',
    idx > 0 ? (rows[idx][3] || '') : '',
    idx > 0 ? (rows[idx][4] || '') : '',
    img1,
    img2,
    img3,
    String(scanResult.count),
    computeEstado(scanResult.count),
    scanResult.folders.join('; '),
    verification,
    resolveNotasForSync({
      isNewRow: idx <= 0,
      existingNotas: idx > 0 ? (rows[idx][12] || '') : '',
      sgio,
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
  countScanSinSgio,
  findNisRowIndex,
  buildNisRowIndexMap,
  applyScanResultsToRows,
  buildScanResultRow,
  parseArrastreRows,
  parseActivo,
  parseFoldersFromValues,
  parseResumenMetrics,
  configValueFromRows,
  countActiveFolders,
};