import type { Orientation, PadronItem } from './data';

export function loadImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(url);
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

const LURIGANCHO_FIRST_PAGE_ROWS = {
  landscape: 18,
  portrait: 37,
} as const satisfies Record<Orientation, number>;

const LURIGANCHO_FOLLOWUP_PAGE_ROWS = {
  landscape: 31,
  portrait: 50,
} as const satisfies Record<Orientation, number>;

export function paginateLuriganchoItems(
  items: PadronItem[],
  orientation: Orientation,
): PadronItem[][] {
  const firstPageRows = LURIGANCHO_FIRST_PAGE_ROWS[orientation];
  const followupRows = LURIGANCHO_FOLLOWUP_PAGE_ROWS[orientation];
  const firstPage = items.slice(0, firstPageRows);
  const remaining = items.slice(firstPageRows);

  return [
    firstPage,
    ...chunkArray(remaining, followupRows).filter((page) => page.length > 0),
  ];
}

export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('No se pudo codificar la página PDF en JPEG.'));
          return;
        }
        try {
          resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (error) {
          reject(error);
        }
      }, 'image/jpeg', quality);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1] || '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      resolve(bytes);
    } catch (error) {
      reject(error);
    }
  });
}

export function getRenderableExportSheets(wrapper: HTMLElement): HTMLElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLElement>('.vpad-sheet')).filter(
    (sheet) => sheet.offsetWidth > 0,
  );
}
