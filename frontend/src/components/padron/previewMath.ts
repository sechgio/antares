import { clamp } from "./pdfHelpers";
import type { Orientation, OutputFormat } from "./data";

export const MAX_PREVIEW_PAGES = 5;

interface NumberedItem {
  item: number | string;
}

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

export function resolvePreviewVariant(
  format: OutputFormat,
): "service-interruption" | "volante-lurigancho" | "volanteo-lurigancho-v2" {
  return isLuriganchoFormat(format) ? format : "service-interruption";
}

export function resolveRowsPerPage(
  format: OutputFormat,
  orientation: Orientation,
): number {
  if (isWaterCutFormat(format)) return 39;
  return orientation === "landscape" ? 18 : 37;
}

export function previewWindow(
  offset: number,
  totalPages: number,
  maxPages = MAX_PREVIEW_PAGES,
): { start: number; end: number } {
  const start = Math.min(offset, Math.max(0, totalPages - maxPages));
  const end = Math.min(start + maxPages, totalPages);
  return { start, end };
}

export function folioLabelTotal(
  physicalFolios: number[],
  activePagesCount: number,
): number {
  return physicalFolios.length > 0
    ? Math.max(...physicalFolios)
    : activePagesCount;
}
