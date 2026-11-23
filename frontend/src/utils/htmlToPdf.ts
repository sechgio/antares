import type { jsPDF as JsPDF } from 'jspdf';
import { base64ToBytes } from './bytesToBase64';
import { chunkArray } from './chunk';

export type PdfOrientation = 'landscape' | 'portrait';

/** CSS px per mm at 96dpi. */
export const PX_PER_MM = 3.7795;
export const DEFAULT_JPEG_QUALITY = 0.92;
export const PDF_EXPORT_BATCH_SIZE = 10;

const A4_LANDSCAPE = { widthMm: 297, heightMm: 210 } as const;
const A4_PORTRAIT = { widthMm: 210, heightMm: 297 } as const;

export function a4PageSizeMm(orientation: PdfOrientation): {
  widthMm: number;
  heightMm: number;
} {
  return orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;
}

export function a4TargetPixelWidth(widthMm: number, scale: number): number {
  return Math.round(widthMm * PX_PER_MM * scale);
}

export const chunkExportItems = <T>(items: readonly T[], batchSize = PDF_EXPORT_BATCH_SIZE): T[][] => {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Invalid PDF export batch size');
  }
  return chunkArray([...items], batchSize);
};

export async function waitForImages(scope: HTMLElement): Promise<void> {
  const images = Array.from(scope.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );
}

export async function waitForFonts(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
}

/** Two animation frames so layout/paint settle before capture. */
export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function createA4Pdf(options: {
  orientation: PdfOrientation;
  compress?: boolean;
  putOnlyUsedFonts?: boolean;
}): Promise<JsPDF> {
  const { default: jsPDF } = await import('jspdf');
  return new jsPDF({
    orientation: options.orientation,
    unit: 'mm',
    format: 'a4',
    ...(options.compress !== undefined ? { compress: options.compress } : {}),
    ...(options.putOnlyUsedFonts !== undefined ? { putOnlyUsedFonts: options.putOnlyUsedFonts } : {}),
  });
}

export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            reject(new Error('No se pudo codificar la página PDF en JPEG.'));
            return;
          }
          try {
            resolve(new Uint8Array(await blob.arrayBuffer()));
          } catch (error) {
            reject(error);
          }
        },
        'image/jpeg',
        quality,
      );
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64ToBytes(base64));
    } catch (error) {
      reject(error);
    }
  });
}
