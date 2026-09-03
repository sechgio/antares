
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

export const ZOOM_PRESETS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 16, 32, 64, 128, 256];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1000) / 1000));
}

export function nextZoomPreset(current: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    const next = ZOOM_PRESETS.find((z) => z > current + 0.001);
    return clampZoom(next ?? MAX_ZOOM);
  }
  const prev = [...ZOOM_PRESETS].reverse().find((z) => z < current - 0.001);
  return clampZoom(prev ?? MIN_ZOOM);
}

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

export function wheelZoomFactor(deltaY: number, ctrlKey: boolean): number {
  const intensity = ctrlKey ? 0.0025 : 0.0015;
  const factor = Math.exp(-deltaY * intensity);
  return Math.min(1.25, Math.max(0.8, factor));
}

export function wheelPanDelta(
  deltaX: number,
  deltaY: number,
  shiftKey: boolean,
): { x: number; y: number } {
  if (shiftKey && deltaX === 0 && deltaY !== 0) return { x: deltaY, y: 0 };
  return { x: deltaX, y: deltaY };
}

export function pinchViewport(
  start: ViewportState,
  startMid: { x: number; y: number },
  curMid: { x: number; y: number },
  ratio: number,
): ViewportState {
  if (!(ratio > 0) || !Number.isFinite(ratio) || start.zoom <= 0) return start;
  const zoom = clampZoom(start.zoom * ratio);
  const contentX = (startMid.x - start.pan.x) / start.zoom;
  const contentY = (startMid.y - start.pan.y) / start.zoom;
  return {
    zoom,
    pan: {
      x: curMid.x - contentX * zoom,
      y: curMid.y - contentY * zoom,
    },
  };
}

export type ViewportState = { zoom: number; pan: { x: number; y: number } };

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function lerpViewport(from: ViewportState, to: ViewportState, t: number): ViewportState {
  const eased = easeOutCubic(t);
  const logFrom = Math.log(Math.max(MIN_ZOOM, from.zoom));
  const logTo = Math.log(Math.max(MIN_ZOOM, to.zoom));
  const zoom = clampZoom(Math.exp(logFrom + (logTo - logFrom) * eased));
  return {
    zoom,
    pan: {
      x: from.pan.x + (to.pan.x - from.pan.x) * eased,
      y: from.pan.y + (to.pan.y - from.pan.y) * eased,
    },
  };
}

export function zoomAnimDuration(fromZoom: number, toZoom: number): number {
  const dist = Math.abs(Math.log(toZoom) - Math.log(fromZoom));
  return Math.min(400, Math.max(150, Math.round(dist * 200)));
}

export type Velocity = { vx: number; vy: number };

export const PAN_FRICTION = 0.92;
export const PAN_MIN_VELOCITY = 0.5;

export function inertiaStep(
  pan: { x: number; y: number },
  velocity: Velocity,
): { pan: { x: number; y: number }; velocity: Velocity } | null {
  const vx = velocity.vx * PAN_FRICTION;
  const vy = velocity.vy * PAN_FRICTION;
  if (Math.abs(vx) < PAN_MIN_VELOCITY && Math.abs(vy) < PAN_MIN_VELOCITY) return null;
  return {
    pan: { x: pan.x + vx, y: pan.y + vy },
    velocity: { vx, vy },
  };
}
