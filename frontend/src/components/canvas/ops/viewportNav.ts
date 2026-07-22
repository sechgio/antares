/** OpenPencil-style viewport navigation helpers. */

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1000) / 1000));
}

/** Fit A4 page into a viewport with padding (matches Artboard initial fit). */
export function fitZoomForViewport(
  viewportWidth: number,
  viewportHeight: number,
  pageWidthPx: number,
  pageHeightPx: number,
  pad = 48,
): number {
  if (viewportWidth < 40 || viewportHeight < 40) return clampZoom(1);
  const fit = Math.min(
    (viewportWidth - pad) / pageWidthPx,
    (viewportHeight - pad) / pageHeightPx,
  );
  return clampZoom(Math.max(MIN_ZOOM, Math.round(fit * 100) / 100));
}

/**
 * Zoom toward a cursor position so the point under the cursor stays fixed.
 * `cursorOffset` is cursor position relative to the viewport center (px).
 * `pan` is the current pan offset (px).
 */
export function zoomAtCursor(
  zoom: number,
  pan: { x: number; y: number },
  cursorOffset: { x: number; y: number },
  nextZoom: number,
): { zoom: number; pan: { x: number; y: number } } {
  const z = clampZoom(nextZoom);
  if (z === zoom) return { zoom, pan };
  const ratio = z / zoom;
  return {
    zoom: z,
    pan: {
      x: cursorOffset.x - (cursorOffset.x - pan.x) * ratio,
      y: cursorOffset.y - (cursorOffset.y - pan.y) * ratio,
    },
  };
}

/** Fit a page-relative rect (mm) into the viewport; centers it with pan. */
export function zoomToFitRectMm(
  viewportWidth: number,
  viewportHeight: number,
  rect: { x: number; y: number; w: number; h: number },
  page: { widthMm: number; heightMm: number },
  mmToPx: number,
  pad = 48,
): { zoom: number; pan: { x: number; y: number } } {
  const w = Math.max(1, rect.w);
  const h = Math.max(1, rect.h);
  if (viewportWidth < 40 || viewportHeight < 40) {
    return { zoom: clampZoom(1), pan: { x: 0, y: 0 } };
  }
  const fit = Math.min(
    (viewportWidth - pad) / (w * mmToPx),
    (viewportHeight - pad) / (h * mmToPx),
  );
  const zoom = clampZoom(Math.max(MIN_ZOOM, Math.round(fit * 100) / 100));
  const scx = rect.x + w / 2;
  const scy = rect.y + h / 2;
  const pageCx = page.widthMm / 2;
  const pageCy = page.heightMm / 2;
  return {
    zoom,
    pan: {
      x: -(scx - pageCx) * mmToPx * zoom,
      y: -(scy - pageCy) * mmToPx * zoom,
    },
  };
}

/** Wheel delta → zoom factor. Positive deltaY = zoom out. */
export function wheelZoomFactor(deltaY: number, ctrlKey: boolean): number {
  // Trackpad pinch often comes as ctrlKey + small deltaY
  const intensity = ctrlKey ? 0.0025 : 0.0015;
  const factor = Math.exp(-deltaY * intensity);
  return Math.min(1.25, Math.max(0.8, factor));
}
