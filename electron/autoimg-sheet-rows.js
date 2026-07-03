const { computeEstado, computeImgFlags } = require('./autoimg-nis');

const BD_IMG_HEADER = [
  'NIS', 'SGIO', 'DESTINO', 'NOMBRE', 'DIRECCION',
  'IMG_1', 'IMG_2', 'IMG_3', 'CANTIDAD', 'ESTADO',
  'ORIGEN_CARPETAS', 'ULTIMA_VERIFICACION', 'NOTAS',
];

function resolveNotasForSync({ isNewRow, existingNotas, sgio }) {
  if (!isNewRow) return existingNotas || '';
  return !String(sgio || '').trim() ? 'NUEVO (sin SGIO)' : '';
}

function countSinSgioRows(rows) {
  const dataRows = rows.length > 1 && String(rows[0]?.[0] || '').toUpperCase() === 'NIS'
    ? rows.slice(1)
    : rows;
  return dataRows.filter((row) => !String(row[1] || '').trim()).length;
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

function buildScanResultRow({ scanResult, rows, verification }) {
  const idx = findNisRowIndex(rows, scanResult.nis);
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

module.exports = {
  BD_IMG_HEADER,
  resolveNotasForSync,
  countSinSgioRows,
  countScanSinSgio,
  findNisRowIndex,
  buildScanResultRow,
  parseArrastreRows,
};