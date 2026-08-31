import { registerAndPersistCanvasImage } from '../utils/imageBlobStore';
import type { PdfImageAsset } from './pdfImportTypes';

const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function safeMimeType(value: string): string {
  if (!SUPPORTED_MIME_TYPES.has(value)) {
    throw new Error(`Tipo de imagen PDF no soportado: ${value || 'desconocido'}`);
  }
  return value;
}

export async function persistPdfImage(
  asset: PdfImageAsset,
): Promise<string> {
  if (!asset.bytes.byteLength) throw new Error(`Imagen PDF vacía: ${asset.key}`);
  const bytes = new Uint8Array(asset.bytes);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: safeMimeType(asset.mimeType) });
  return registerAndPersistCanvasImage(blob);
}
