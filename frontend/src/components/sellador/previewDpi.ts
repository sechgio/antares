const MIN_PREVIEW_PIXEL_WIDTH = 2800;
const MAX_PREVIEW_PIXEL_WIDTH = 6144;

/** Effective DPR for Electron on Windows (often reports 1.0 at 125–150% scaling). */
function effectiveDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 2;
  const reported = window.devicePixelRatio || 1;
  return Math.max(reported, 1.5);
}

/** CSS width → raster width for sharp on-screen PDF previews. */
export function selladorPreviewPixelWidth(cssWidth: number): number {
  const clamped = Math.max(cssWidth, 400);
  const dpr = effectiveDevicePixelRatio();
  const scaled = Math.round(clamped * dpr * 2.5);
  return Math.min(Math.max(scaled, MIN_PREVIEW_PIXEL_WIDTH), MAX_PREVIEW_PIXEL_WIDTH);
}

export function selladorPreviewDpr(): number {
  return Math.min(effectiveDevicePixelRatio() * 2.5, 4);
}
