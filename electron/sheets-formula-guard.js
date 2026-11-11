'use strict';

// cloud-oauth-connectors-004/009: Sheets recibe todo con valueInputOption USER_ENTERED,
// así que una celda que empieza con «=», «+», «-» no numérico, «@» o un carácter de
// control se interpreta como fórmula: el nombre sincronizado de una carpeta Drive o
// un valor del renderer pueden ejecutar fórmulas (IMPORTXML, HYPERLINK, referencias
// @tabla) en la hoja del usuario. Antes de salir por el API, las celdas de texto
// riesgosas se anteponen con apóstrofe — la vía estándar de Sheets para guardarlas
// como texto; los números con signo (-123.45, +7, 1e9, 50%) pasan intactos.

const NUMERIC_CELL_RE = /^[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?%?$/i;
const UNSAFE_FIRST_RE = /^[=+@\-\t\r\n\u000b\u000c]/;

function neutralizeCell(value) {
  if (typeof value !== 'string' || value === '' || !UNSAFE_FIRST_RE.test(value)) return value;
  if (NUMERIC_CELL_RE.test(value)) return value;
  return `'${value}`;
}

function neutralizeCells(values) {
  if (!Array.isArray(values)) return values;
  return values.map((row) => (Array.isArray(row) ? row.map(neutralizeCell) : neutralizeCell(row)));
}

module.exports = { neutralizeCell, neutralizeCells };
