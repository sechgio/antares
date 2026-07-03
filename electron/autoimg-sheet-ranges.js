const ALLOWED_SHEETS = new Set(['BD_IMG', 'FOLDERS', 'BD_ARRASTRE', 'LOGS', 'CONFIG', 'RESUMEN']);

const RANGE_RE = /^(BD_IMG|FOLDERS|BD_ARRASTRE|LOGS|CONFIG|RESUMEN)![A-Za-z0-9:]+$/;

function assertAllowedSheetRange(range) {
  const trimmed = String(range || '').trim();
  if (!trimmed) throw new Error('Rango de Sheet vacío');
  if (!RANGE_RE.test(trimmed)) {
    const sheet = trimmed.includes('!') ? trimmed.split('!')[0] : trimmed;
    throw new Error(`Rango de Sheet no permitido: ${sheet}`);
  }
  const sheetName = trimmed.split('!')[0];
  if (!ALLOWED_SHEETS.has(sheetName)) {
    throw new Error(`Hoja no permitida: ${sheetName}`);
  }
  return trimmed;
}

module.exports = { ALLOWED_SHEETS, assertAllowedSheetRange };