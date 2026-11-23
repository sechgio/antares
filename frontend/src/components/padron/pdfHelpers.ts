import { chunkArray as chunkToPages } from '../../utils/chunk';
import { canvasToJpegBytes } from '../../utils/htmlToPdf';
import type { Orientation, PadronItem } from './data';

export { canvasToJpegBytes };

const _imageBase64Cache = new Map<string, Promise<string>>();

export function clearImageBase64Cache(): void {
  _imageBase64Cache.clear();
}

export function loadImageAsBase64(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return Promise.resolve(url);

  const cached = _imageBase64Cache.get(url);
  if (cached) return cached;

  const promise = new Promise<string>((resolve) => {
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
    img.onerror = () => {
      _imageBase64Cache.delete(url);
      resolve(url);
    };
    img.src = url;
  });

  _imageBase64Cache.set(url, promise);
  return promise;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks = chunkToPages(arr, size);
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

export function paginateLuriganchoItems(items: PadronItem[], orientation: Orientation): PadronItem[][] {
  const firstPageRows = LURIGANCHO_FIRST_PAGE_ROWS[orientation];
  const followupRows = LURIGANCHO_FOLLOWUP_PAGE_ROWS[orientation];
  const firstPage = items.slice(0, firstPageRows);
  const remaining = items.slice(firstPageRows);

  return [firstPage, ...chunkArray(remaining, followupRows).filter((page) => page.length > 0)];
}

export function getRenderableExportSheets(wrapper: HTMLElement): HTMLElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLElement>('.vpad-sheet')).filter((sheet) => sheet.offsetWidth > 0);
}
