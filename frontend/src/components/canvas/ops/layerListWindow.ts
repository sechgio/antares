export const LAYER_ROW_H = 28;
export const LAYER_OVERSCAN = 8;
export const LAYER_VIRTUALIZE_AT = 80;

export function clampLayerScrollTop(
  scrollTop: number,
  rowCount: number,
  listHeight: number,
  rowH = LAYER_ROW_H,
): number {
  const maxScroll = Math.max(0, rowCount * rowH - Math.max(0, listHeight));
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return 0;
  return Math.min(scrollTop, maxScroll);
}

export function layerVirtualWindow(opts: {
  rowCount: number;
  scrollTop: number;
  listHeight: number;
  rowH?: number;
  overscan?: number;
}): { start: number; end: number; padTop: number; padBottom: number; scrollTop: number } {
  const rowH = opts.rowH ?? LAYER_ROW_H;
  const overscan = opts.overscan ?? LAYER_OVERSCAN;
  const listHeight = Math.max(0, opts.listHeight);
  const scrollTop = clampLayerScrollTop(opts.scrollTop, opts.rowCount, listHeight, rowH);
  if (opts.rowCount <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0, scrollTop: 0 };
  }
  const visible = Math.max(1, Math.ceil((listHeight || rowH) / rowH) + overscan * 2);
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(opts.rowCount, Math.max(start + 1, start + visible));
  const safeStart = Math.min(start, Math.max(0, opts.rowCount - 1));
  const safeEnd = Math.max(safeStart + 1, end);
  return {
    start: safeStart,
    end: Math.min(opts.rowCount, safeEnd),
    padTop: safeStart * rowH,
    padBottom: Math.max(0, (opts.rowCount - Math.min(opts.rowCount, safeEnd)) * rowH),
    scrollTop,
  };
}

export function nextLayerRowIndex(current: number, rowCount: number, direction: 1 | -1): number {
  if (rowCount <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : rowCount - 1;
  return Math.max(0, Math.min(rowCount - 1, current + direction));
}

export function scrollTopToRevealIndex(
  index: number,
  rowH: number,
  listHeight: number,
  currentScrollTop: number,
): number {
  if (index < 0 || listHeight <= 0) return Math.max(0, currentScrollTop);
  const top = index * rowH;
  const bottom = top + rowH;
  if (top < currentScrollTop) return top;
  if (bottom > currentScrollTop + listHeight) return Math.max(0, bottom - listHeight);
  return currentScrollTop;
}
