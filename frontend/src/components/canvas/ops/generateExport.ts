import { matchesRecordId, normalizeRecordId } from '../runtime/excel';

export type GenerateExportScope = 'single' | 'all';

export function selectGenerateRowIndices(options: {
  rows: Record<string, string>[];
  rowIndex: number;
  exportScope: GenerateExportScope;
  idColumn: string;
  requiresImages: boolean;
  images: File[];
  imagesByRecordId?: ReadonlyMap<string, File[]>;
}): number[] {
  const { rows, rowIndex, exportScope, idColumn, requiresImages, images, imagesByRecordId } = options;
  if (!rows.length) return [];

  const rowHasImages = (row: Record<string, string>): boolean => {
    if (!requiresImages) return true;
    if (!idColumn) return false;
    const recordId = row[idColumn] || '';
    if (!recordId) return false;
    if (imagesByRecordId) return (imagesByRecordId.get(normalizeRecordId(recordId))?.length ?? 0) > 0;
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
