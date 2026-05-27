import { matchesRecordId, naturalSortByName } from './utils';
export {
  buildLocalImageToken,
  fileToDataUrl,
  imageToPdfDataUrl,
  imageToPdfSource,
  type PdfImageSource,
} from '../../utils/pdfAssets';

export type PdfExportScope = 'single' | 'all';
export type PdfQuality = 'high' | 'low';

export interface PdfExportRow {
  row: Record<string, unknown>;
  rowIndex: number;
  idValue: string;
  images: File[];
}

export function safeFilenamePart(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || 'reporte';
}

export function buildPdfFilename({
  exportScope,
  templateName,
  idValue,
  date = new Date(),
}: {
  exportScope: PdfExportScope;
  templateName?: string | null;
  idValue?: unknown;
  date?: Date;
}): string {
  const baseName = templateName ? templateName.replace(/\.html?$/i, '') : 'panel_fotografico';
  if (exportScope === 'all') {
    return `${safeFilenamePart(baseName)}_consolidado_${date.toISOString().slice(0, 10)}.pdf`;
  }
  return `${safeFilenamePart(baseName)}_${safeFilenamePart(idValue)}.pdf`;
}

export function selectRowsForPdfExport({
  data,
  selectedIndex,
  exportScope,
  idColumn,
  requiresImages,
  images,
}: {
  data: Record<string, unknown>[];
  selectedIndex: string;
  exportScope: PdfExportScope;
  idColumn: string;
  requiresImages: boolean;
  images: File[];
}): PdfExportRow[] {
  const imagesForRow = (row: Record<string, unknown>): File[] => {
    if (!requiresImages || !idColumn) return [];
    const idValue = String(row[idColumn] ?? '');
    if (!idValue) return [];
    return images.filter(img => matchesRecordId(img.name, idValue)).sort(naturalSortByName);
  };

  if (exportScope === 'single') {
    const rowIndex = Number(selectedIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= data.length) return [];
    const row = data[rowIndex];
    return [{
      row,
      rowIndex,
      idValue: idColumn ? String(row[idColumn] ?? rowIndex + 1) : String(rowIndex + 1),
      images: imagesForRow(row),
    }];
  }

  return data.flatMap((row, rowIndex) => {
    const rowImages = imagesForRow(row);
    if (requiresImages && rowImages.length === 0) return [];
    return [{
      row,
      rowIndex,
      idValue: idColumn ? String(row[idColumn] ?? rowIndex + 1) : String(rowIndex + 1),
      images: rowImages,
    }];
  });
}

function extractHtmlParts(html: string): { head: string; body: string } {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      head: doc.head?.innerHTML || '',
      body: doc.body?.innerHTML || html,
    };
  }

  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  return { head, body };
}

export function mergeHtmlDocuments(documents: string[]): string {
  const parts = documents.map(extractHtmlParts);
  const head = parts.map(part => part.head).filter(Boolean).join('\n');
  const body = parts.map(part => part.body).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
${head}
<style id="antares-consolidated-pdf">
  @page { size: A4 portrait; margin: 0; }
  html, body { width: auto !important; height: auto !important; margin: 0; padding: 0; overflow: visible !important; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
