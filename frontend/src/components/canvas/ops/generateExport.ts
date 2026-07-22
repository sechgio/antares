import { matchesRecordId } from '../runtime/excel';

export type GenerateExportScope = 'single' | 'all';

/** Indices of rows to include in PDF export (mirrors Generador Reportes). */
export function selectGenerateRowIndices(options: {
  rows: Record<string, string>[];
  rowIndex: number;
  exportScope: GenerateExportScope;
  idColumn: string;
  requiresImages: boolean;
  images: File[];
}): number[] {
  const { rows, rowIndex, exportScope, idColumn, requiresImages, images } = options;
  if (!rows.length) return [];

  const rowHasImages = (row: Record<string, string>): boolean => {
    if (!requiresImages) return true;
    if (!idColumn) return false;
    const recordId = row[idColumn] || '';
    if (!recordId) return false;
    return images.some((f) => matchesRecordId(f.name, recordId));
  };

  if (exportScope === 'single') {
    const row = rows[rowIndex];
    if (!row) return [];
    if (!rowHasImages(row)) return [];
    return [rowIndex];
  }

  return rows.flatMap((row, i) => (rowHasImages(row) ? [i] : []));
}
