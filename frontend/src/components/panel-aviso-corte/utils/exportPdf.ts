import { api } from '../../../api';
import { buildTimestampedFilename, downloadBase64Blob, fileToBase64 } from '../../../utils/pdfAssets';
import { stageFileForIpc } from '../../../utils/stageFile';
import { DEFAULT_PANEL_TEMPLATE, type PanelTemplateId } from '../constants';
import { normalizePanelDateStr } from './excelPreview';
import type { LocalImage, PanelVM } from '../types';

export async function buildImagePayload(
  images: Map<string, LocalImage>,
  toBase64: (file: File) => Promise<string> = fileToBase64,
): Promise<{
  imagePaths: Record<string, string>;
  imagesBase64: Record<string, string>;
}> {
  const imagePaths: Record<string, string> = {};
  const imagesBase64: Record<string, string> = {};

  for (const [filename, image] of images.entries()) {
    const token = await stageFileForIpc(image.file);
    if (token) {
      imagePaths[filename] = token;
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
  templateId: PanelTemplateId = DEFAULT_PANEL_TEMPLATE,
  exportMode: 'skip_empty' | 'include_empty' = 'skip_empty',
): Promise<{ filename: string }> {
  const logos: { left_b64?: string; right_b64?: string } = {};
  if (logoLeft) logos.left_b64 = await fileToBase64(logoLeft);
  if (logoRight) logos.right_b64 = await fileToBase64(logoRight);

  const { imagePaths, imagesBase64 } = await buildImagePayload(images);

  const panelsPayload = panels.map((p) => ({
    cuadrante: p.cuadrante,
    fecha_corte: normalizePanelDateStr(p.fechaCorte),
    motivo: p.motivo,
    imagenes: p.imagenes,
    source_row_index: p.sourceRowIndex,
  }));

  const ext = format === 'docx' ? 'docx' : 'pdf';
  const defaultName = buildTimestampedFilename('panel_aviso_corte', format);

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

  const mimeType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';

  downloadBase64Blob(content, resp.filename, mimeType);

  return { filename: resp.filename };
}
