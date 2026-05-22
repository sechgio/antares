import { matchesRecordId, naturalSortByName } from './utils';

export type PdfExportScope = 'single' | 'all';
export type PdfQuality = 'high' | 'low';

const LOCAL_IMAGE_TOKEN_PREFIX = 'antares-local-image:';

export interface PdfExportRow {
  row: Record<string, unknown>;
  rowIndex: number;
  idValue: string;
  images: File[];
}

export interface PdfImageSource {
  src: string;
  localPath?: string;
  token?: string;
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

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function getElectronFilePath(file: File): string | null {
  const maybePath = (file as File & { path?: unknown }).path;
  if (typeof maybePath !== 'string' || !maybePath.trim()) return null;
  return maybePath;
}

export function buildLocalImageToken(key: string): string {
  return `${LOCAL_IMAGE_TOKEN_PREFIX}${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function compressImageForPdf(
  file: File,
  options: { maxSide: number; quality: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const { maxSide, quality } = options;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas no disponible');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo optimizar la imagen'));
    };

    img.src = url;
  });
}

export async function imageToPdfDataUrl(file: File, quality: PdfQuality): Promise<string> {
  if (quality === 'high') {
    try {
      return await compressImageForPdf(file, { maxSide: 2600, quality: 0.9 });
    } catch {
      return fileToDataUrl(file);
    }
  }
  try {
    return await compressImageForPdf(file, { maxSide: 1400, quality: 0.68 });
  } catch {
    return fileToDataUrl(file);
  }
}

export async function imageToPdfSource(
  file: File,
  quality: PdfQuality,
  key: string,
): Promise<PdfImageSource> {
  if (quality === 'high') {
    const localPath = getElectronFilePath(file);
    if (localPath) {
      const token = buildLocalImageToken(key);
      return { src: token, localPath, token };
    }
  }

  return { src: await imageToPdfDataUrl(file, quality) };
}
