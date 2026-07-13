/** Display-only raster floor (~readable on-screen, not print-DPI). */
export const MIN_PREVIEW_PIXEL_WIDTH = 900;
/** Display-only raster ceiling to bound canvas / backend preview cost. */
export const MAX_PREVIEW_PIXEL_WIDTH = 2048;

/** Effective DPR for Electron on Windows (often reports 1.0 at 125–150% scaling). */
function effectiveDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 2;
  const reported = window.devicePixelRatio || 1;
  return Math.max(reported, 1.5);
}

/**
 * Display-oriented scale factor for on-screen PDF previews.
 * Uses min(dpr, 2) * 1.5 so Windows 125–150% stays sharp without multi-megapixel canvases.
 * Export/apply geometry does NOT use this — preview only.
 */
export function selladorPreviewDpr(): number {
  const dpr = effectiveDevicePixelRatio();
  return Math.min(Math.min(dpr, 2) * 1.5, 3);
}

/** CSS width → raster width for sharp on-screen PDF previews (clamped to display caps). */
export function selladorPreviewPixelWidth(cssWidth: number): number {
  const clamped = Math.max(cssWidth, 400);
  const scaled = Math.round(clamped * selladorPreviewDpr());
  return Math.min(Math.max(scaled, MIN_PREVIEW_PIXEL_WIDTH), MAX_PREVIEW_PIXEL_WIDTH);
}
