import { api } from '../api';
import { downloadBase64Blob } from './pdfAssets';

interface RenderedDocumentResponse {
  content_base64: string;
  filename: string;
}

/**
 * Ask the user for a PDF output path through the native save dialog.
 * Returns null when the dialog is cancelled.
 */
export async function askPdfSavePath(defaultFilename: string, title: string): Promise<string | null> {
  const saveTarget = await api.dialogSave({
    title,
    defaultPath: defaultFilename,
    filters: [
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  return saveTarget.paths[0] || null;
}

/**
 * Shared tail of "render a document" exports: on Electron, ask for a save path
 * and pass it to the renderer; on web, download the returned base64 payload.
 */
export async function renderAndDeliverDocument<TPayload, TResp extends RenderedDocumentResponse>(
  payload: TPayload,
  render: (body: TPayload, outputPath?: string) => Promise<TResp>,
  { defaultName, format }: { defaultName: string; format: 'pdf' | 'docx' },
): Promise<{ filename: string }> {
  const ext = format === 'docx' ? 'docx' : 'pdf';

  if (window.electronAPI?.invoke) {
    const dialogResp = await api.dialogSave({
      title: 'Guardar documento',
      defaultPath: defaultName,
      filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [ext] }],
    });
    if (dialogResp.paths && dialogResp.paths.length > 0) {
      const outputPath = dialogResp.paths[0];
      const resp = await render(payload, outputPath);
      return { filename: resp.filename || outputPath };
    }
    return { filename: '' };
  }

  const resp = await render(payload);
  const content = resp.content_base64;
  const mimeType = format === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';

  downloadBase64Blob(content, resp.filename, mimeType);

  return { filename: resp.filename };
}
