import { chunkArray, clamp } from "./pdfHelpers";
import type { Orientation, OutputFormat } from "./data";

export const MAX_PREVIEW_PAGES = 5;

interface NumberedItem {
  item: number | string;
}

/** Items ordenados dentro del rango [start, end] clamped a [1, max]. */
export function filterItemsInRange<T extends NumberedItem>(
  items: T[],
  start: number,
  end: number,
  max: number,
): T[] {
  const s = clamp(start, 1, max);
  const e = clamp(end, s, max);
  return items
    .filter((item) => {
      const n = Number(item.item) || 0;
      return n >= s && n <= e;
    })
    .sort((a, b) => Number(a.item) - Number(b.item));
}

/** Redimensiona la lista a `count` preservando los items existentes por índice. */
export function resizeItemsPreserve<T extends NumberedItem>(
  prevItems: T[],
  count: number,
  createItems: (total: number) => T[],
): T[] {
  const newItems = createItems(count);
  prevItems.forEach((existing) => {
    const idx = Number(existing.item) - 1;
    if (idx >= 0 && idx < count) {
      newItems[idx] = { ...existing };
    }
  });
  return newItems;
}

export function isWaterCutFormat(format: OutputFormat): boolean {
  return format === "water-cut-notice";
}

export function isLuriganchoFormat(
  format: OutputFormat,
): format is "volante-lurigancho" | "volanteo-lurigancho-v2" {
  return format === "volante-lurigancho" || format === "volanteo-lurigancho-v2";
}

/** Variante de preview: lurigancho tiene la suya; el resto usa la de servicio. */
export function resolvePreviewVariant(
  format: OutputFormat,
): "service-interruption" | "volante-lurigancho" | "volanteo-lurigancho-v2" {
  return isLuriganchoFormat(format) ? format : "service-interruption";
}

/** Filas por página según formato/orientación (water-cut fija 39 portrait). */
export function resolveRowsPerPage(
  format: OutputFormat,
  orientation: Orientation,
): number {
  if (isWaterCutFormat(format)) return 39;
  return orientation === "landscape" ? 18 : 37;
}

/** Ventana de páginas visibles en la preview (máx. MAX_PREVIEW_PAGES). */
export function previewWindow(
  offset: number,
  totalPages: number,
  maxPages = MAX_PREVIEW_PAGES,
): { start: number; end: number } {
  const start = Math.min(offset, Math.max(0, totalPages - maxPages));
  const end = Math.min(start + maxPages, totalPages);
  return { start, end };
}

/** Total mostrado en el label de folios: el mayor físico o el count de páginas. */
export function folioLabelTotal(
  physicalFolios: number[],
  activePagesCount: number,
): number {
  return physicalFolios.length > 0
    ? Math.max(...physicalFolios)
    : activePagesCount;
}

export { chunkArray };
