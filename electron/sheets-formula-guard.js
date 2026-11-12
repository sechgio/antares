'use strict';

// USER_ENTERED: una celda que empieza con «=», «+», «-» no numérico, «@» o control se interpreta como fórmula;
// el apóstrofe la guarda como texto y los números con signo (-123.45, +7, 1e9, 50%) pasan intactos.

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
