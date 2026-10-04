export type EstadoFilter = 'all' | 'completo' | 'faltante' | 'sobrante';

export function rowEstado(row: string[]): string {
  return String(row[9] || '');
}

export function rowEstadoType(estado: string): EstadoFilter | 'other' {
  if (estado.includes('🟢') || estado.toUpperCase().includes('COMPLETO')) return 'completo';
  if (estado.includes('🔴') || estado.toUpperCase().includes('FALTANTE')) return 'faltante';
  if (estado.includes('🟡') || estado.toUpperCase().includes('SOBRANTE')) return 'sobrante';
  return 'other';
}

// La fila 0 es encabezado solo si abre con el nombre canónico de la primera
// columna (igual que tabStartIndex en electron/autoimg-sheet-rows.js): una
// hoja sin encabezado no debe perder su primera fila de datos.
export function getBdImgDataRows(rows: string[][]): string[][] {
  const first = rows[0];
  if (first && String(first[0] || '').trim().toUpperCase() === 'NIS') {
    return rows.slice(1);
  }
  return rows;
}

export function filterBdImgRows(
  dataRows: string[][],
  filter: EstadoFilter,
  search: string,
): string[][] {
  const q = search.trim().toLowerCase();
  return dataRows.filter((row) => {
    const type = rowEstadoType(rowEstado(row));
    if (filter === 'completo' && type !== 'completo') return false;
    if (filter === 'faltante' && type !== 'faltante') return false;
    if (filter === 'sobrante' && type !== 'sobrante') return false;
    if (q) {
      const haystack = [row[0], row[1], row[3], row[10]].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}