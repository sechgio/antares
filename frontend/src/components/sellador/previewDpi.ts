export const MIN_PREVIEW_PIXEL_WIDTH = 900;
export const MAX_PREVIEW_PIXEL_WIDTH = 2048;

function effectiveDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 2;
  const reported = window.devicePixelRatio || 1;
  return Math.max(reported, 1.5);
}

export function selladorPreviewDpr(): number {
  const dpr = effectiveDevicePixelRatio();
  return Math.min(Math.min(dpr, 2) * 1.5, 3);
}

export function selladorPreviewPixelWidth(cssWidth: number): number {
  const clamped = Math.max(cssWidth, 400);
  const scaled = Math.round(clamped * selladorPreviewDpr());
  return Math.min(Math.max(scaled, MIN_PREVIEW_PIXEL_WIDTH), MAX_PREVIEW_PIXEL_WIDTH);
}
