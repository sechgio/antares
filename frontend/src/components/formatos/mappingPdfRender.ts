import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfPageSize } from './mappingCoords';

export const MAPPING_RENDER_SCALE_CAP = 2.5;
export const MAPPING_RENDER_DPR_CAP = 1.5;

export function computeMappingRenderScale(
  containerW: number,
  pageWidth: number,
  dpr = MAPPING_RENDER_DPR_CAP,
): number {
  if (pageWidth <= 0 || containerW <= 0) return 1;
  return Math.min((containerW / pageWidth) * dpr, MAPPING_RENDER_SCALE_CAP);
}

export async function renderMappingPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  dpr = MAPPING_RENDER_DPR_CAP,
): Promise<{ url: string; pageSize: PdfPageSize }> {
  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = computeMappingRenderScale(containerW, unscaled.width, dpr);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    url: canvas.toDataURL('image/jpeg', 0.88),
    pageSize: { width: unscaled.width, height: unscaled.height },
  };
}

export const MAPPING_LOAD_TIMEOUT_MS = 25_000;

const RESTART_HINT =
  'Cierra y reinicia la aplicación por completo (npm run dev) para aplicar los nuevos métodos del backend.';

export function isStaleBackendError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('IPC method not allowed: formatos_render_template_page') ||
    message.includes('IPC method not allowed: formatos_get_template') ||
    message.includes('Método desconocido: formatos_render_template_page') ||
    message.includes('Método desconocido: formatos_get_template')
  );
}

export function formatMappingLoadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (isStaleBackendError(err)) {
    return RESTART_HINT;
  }
  if (message.includes('Tiempo agotado cargando el template')) {
    return message;
  }
  return message || 'No se pudo cargar el template.';
}

export function withMappingLoadTimeout<T>(
  promise: Promise<T>,
  timeoutMs = MAPPING_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Tiempo agotado cargando el template.'));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}
