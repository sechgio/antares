import { api } from '../../../api';
import { DEFAULT_PANEL_TEMPLATE, type PanelTemplateId } from '../constants';
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

function _defaultFilename(format: 'pdf' | 'docx'): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `panel_aviso_corte_${ts}.${format}`;
}

export async function exportPanelDocument(
  panels: PanelVM[],
  logoLeft: File | null,
  logoRight: File | null,
  images: Map<string, LocalImage>,
  format: 'pdf' | 'docx' = 'pdf',
  templateId: PanelTemplateId = DEFAULT_PANEL_TEMPLATE,
  exportMode: 'skip_empty' | 'include_empty' = 'skip_empty',
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

  const ext = format === 'docx' ? 'docx' : 'pdf';
  const defaultName = _defaultFilename(format);

  // In Electron: write directly to disk via save dialog to avoid
  // base64-encoding large documents through IPC (which caps at ~128MB).
  if (window.electronAPI?.invoke) {
    const dialogResp = await api.dialogSave({
      title: 'Guardar documento',
      defaultPath: defaultName,
      filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [ext] }],
    });
    if (dialogResp.paths && dialogResp.paths.length > 0) {
      const outputPath = dialogResp.paths[0];
      const resp = await api.panelAvisoCorteRenderPdf({
        panels: panelsPayload,
        logos,
        images: imagesBase64,
        image_paths: imagePaths,
        format,
        template_id: templateId,
        output_path: outputPath,
        export_mode: exportMode,
      });
      return { filename: resp.filename || outputPath };
    }
    return { filename: '' };
  }

  // Browser fallback: download via blob
  const resp = await api.panelAvisoCorteRenderPdf({
    panels: panelsPayload,
    logos,
    images: imagesBase64,
    image_paths: imagePaths,
    format,
    template_id: templateId,
    export_mode: exportMode,
  });

  const content = resp.content_base64 || resp.pdf_base64;
  const contentBytes = atob(content);
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
