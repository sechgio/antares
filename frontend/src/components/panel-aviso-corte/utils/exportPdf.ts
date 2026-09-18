import { api } from '../../../api';
import { renderAndDeliverDocument } from '../../../utils/deliverRenderedDocument';
import { buildTimestampedFilename, fileToBase64 } from '../../../utils/pdfAssets';
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

  const defaultName = buildTimestampedFilename('panel_aviso_corte', format);

  const payload = {
    panels: panelsPayload,
    logos,
    images: imagesBase64,
    image_paths: imagePaths,
    format,
    template_id: templateId,
    export_mode: exportMode,
  };
  return renderAndDeliverDocument(
    payload,
    (body, outputPath) => api.panelAvisoCorteRenderPdf({ ...body, output_path: outputPath }),
    { defaultName, format },
  );
}
