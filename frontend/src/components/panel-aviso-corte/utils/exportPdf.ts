import { api } from '../../../api';
import { readFileAsBase64 } from './fileLoader';
import type { LocalImage, PanelVM } from '../types';

export async function buildImagePayload(
  images: Map<string, LocalImage>,
  toBase64: (file: File) => Promise<string> = readFileAsBase64,
): Promise<{
  imagePaths: Record<string, string>;
  imagesBase64: Record<string, string>;
}> {
  const imagePaths: Record<string, string> = {};
  const imagesBase64: Record<string, string> = {};

  for (const [filename, image] of images.entries()) {
    if (image.localPath) {
      imagePaths[filename] = image.localPath;
      continue;
    }
    imagesBase64[filename] = await toBase64(image.file);
  }

  return { imagePaths, imagesBase64 };
}

export async function exportPanelDocument(
  panels: PanelVM[],
  logoLeft: File | null,
  logoRight: File | null,
  images: Map<string, LocalImage>,
  format: 'pdf' | 'docx' = 'pdf',
): Promise<{ filename: string }> {
  const logos: { left_b64?: string; right_b64?: string } = {};
  if (logoLeft) logos.left_b64 = await readFileAsBase64(logoLeft);
  if (logoRight) logos.right_b64 = await readFileAsBase64(logoRight);

  const { imagePaths, imagesBase64 } = await buildImagePayload(images);

  const normalizeDate = (raw: string): string => {
    const s = raw.trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/);
    if (isoMatch) return isoMatch[1];
    const dmyMatch = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return s;
  };

  const panelsPayload = panels.map((p) => ({
    cuadrante: p.cuadrante,
    fecha_corte: normalizeDate(p.fechaCorte),
    motivo: p.motivo,
    imagenes: p.imagenes,
    source_row_index: p.sourceRowIndex,
  }));

  const resp = await api.panelAvisoCorteRenderPdf({
    panels: panelsPayload,
    logos,
    images: imagesBase64,
    image_paths: imagePaths,
    format,
  });

  const contentBytes = atob(resp.pdf_base64);
  const buffer = new Uint8Array(contentBytes.length);
  for (let i = 0; i < contentBytes.length; i++) {
    buffer[i] = contentBytes.charCodeAt(i);
  }

  const mimeType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';

  const blob = new Blob([buffer], { type: mimeType });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = resp.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  return { filename: resp.filename };
}
