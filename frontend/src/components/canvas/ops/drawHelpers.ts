/** Helpers for OpenPencil-style click-drag drawing on the A4 artboard. */

export const MM_TO_PX = 96 / 25.4;

export type DrawRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Original drag endpoints in page mm (line tool). */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

/**
 * mm → screen px at the current zoom.
 * Prefer this over CSS `transform: scale()` so the browser re-paints vectors/text
 * at the zoomed size (Figma / OpenPencil crispness) instead of upscaling a bitmap.
 * Rounded to whole CSS pixels to avoid subpixel AA blur on borders/text.
 */
export function mmToScreenPx(mmValue: number, zoom: number): number {
  return Math.round(mmValue * MM_TO_PX * zoom);
}

/**
 * Scale a CSS length by zoom (`11px` → `22px` at 200%).
 * Leaves percentages and non-length keywords unchanged.
 * Pixel lengths are rounded so fonts/borders stay on whole CSS pixels.
 */
export function scaleCssLength(value: string | undefined, zoom: number): string | undefined {
  if (value == null || value === '') return value;
  const trimmed = value.trim();
  if (trimmed.includes('%') || !/^-?[\d.]/.test(trimmed)) return value;
  const match = /^(-?[\d.]+)([a-z]*)$/i.exec(trimmed);
  if (!match) return value;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return value;
  const unit = match[2] || 'px';
  const scaled = n * zoom;
  const snapped = unit === 'px' || unit === '' ? Math.round(scaled) : scaled;
  return `${snapped}${unit || 'px'}`;
}

/** Convert client pointer position to mm relative to the artboard frame. */
export function clientToMm(
  clientX: number,
  clientY: number,
  frameRect: DOMRect,
  zoom: number,
): { xMm: number; yMm: number } {
  const scale = zoom * MM_TO_PX;
  return {
    xMm: (clientX - frameRect.left) / scale,
    yMm: (clientY - frameRect.top) / scale,
  };
}

/**
 * Normalize a drag from (x0,y0) to (x1,y1) into a positive rect.
 * Shift constrains to square (OpenPencil behavior for rect/ellipse).
 */
export function normalizeDrawRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  options?: { constrainSquare?: boolean; minSizeMm?: number },
): DrawRect {
  let w = x1 - x0;
  let h = y1 - y0;
  if (options?.constrainSquare) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  let x = w >= 0 ? x0 : x0 + w;
  let y = h >= 0 ? y0 : y0 + h;
  let absW = Math.abs(w);
  let absH = Math.abs(h);
  const min = options?.minSizeMm ?? 0;
  if (absW < min) absW = min;
  if (absH < min) absH = min;
  return { x, y, w: absW, h: absH };
}

/** True if drag was essentially a click (place default-sized layer). */
export function isClickPlace(rect: DrawRect, thresholdMm = 3): boolean {
  return rect.w < thresholdMm && rect.h < thresholdMm;
}

/**
 * CSS translate/size vars for placing a layer.
 * Allows negative x/y (free canvas), matching moveSelection.
 */
export function placeRectCssVars(
  x: number,
  y: number,
  w: number,
  h: number,
): {
  '--translate-x': string;
  '--translate-y': string;
  '--width': string;
  '--height': string;
} {
  return {
    '--translate-x': `${x}mm`,
    '--translate-y': `${y}mm`,
    '--width': `${w}mm`,
    '--height': `${h}mm`,
  };
}

export const PLACE_TOOLS = new Set([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'star',
  'diamond',
  'hexagon',
  'pentagon',
  'text',
  'field',
  'logo',
  'image',
  'imageSlot',
  'grid',
  'table',
  'checkbox',
  'signature',
]);

export function isPlaceTool(tool: string): boolean {
  return PLACE_TOOLS.has(tool);
}
