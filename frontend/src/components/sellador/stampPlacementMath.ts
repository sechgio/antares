import type { PdfPageSize, StampDragMode, StampRect } from './types';
import { clampStampRect } from './utils';

export interface ClientBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Convierte coordenadas de cliente (px de pantalla) a puntos PDF. */
export function clientPointToPdfPoint(
  clientX: number,
  clientY: number,
  bounds: ClientBounds | null,
  pageSize: PdfPageSize,
): { x: number; y: number } {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - bounds.left) / bounds.width) * pageSize.width,
    y: ((clientY - bounds.top) / bounds.height) * pageSize.height,
  };
}

/**
 * Calcula el rect destino de un drag activo: 'move' traslada por delta,
 * 'resize' ajusta width preservando el aspect ratio del origen.
 */
export function computeDragRect(
  mode: StampDragMode,
  origin: StampRect,
  start: { x: number; y: number },
  point: { x: number; y: number },
  pageSize: PdfPageSize,
): StampRect {
  if (mode === 'move') {
    return clampStampRect(
      { ...origin, x: origin.x + (point.x - start.x), y: origin.y + (point.y - start.y) },
      pageSize,
    );
  }
  const aspect = origin.width / origin.height;
  const nextWidth = Math.max(24, point.x - origin.x);
  return clampStampRect({ ...origin, width: nextWidth, height: nextWidth / aspect }, pageSize);
}

/** Rect resultante de soltar el sello centrado sobre el punto de drop. */
export function computeDropRect(
  rect: StampRect,
  point: { x: number; y: number },
  pageSize: PdfPageSize,
): StampRect {
  const aspect = rect.width / rect.height;
  return clampStampRect(
    {
      ...rect,
      x: point.x - rect.width / 2,
      y: point.y - rect.height / 2,
      width: rect.width,
      height: rect.width / aspect,
    },
    pageSize,
  );
}

/** Convierte un rect PDF a posición CSS en porcentajes de la página. */
export function rectToOverlayPercent(
  rect: StampRect,
  pageSize: PdfPageSize,
): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(rect.x / pageSize.width) * 100}%`,
    top: `${(rect.y / pageSize.height) * 100}%`,
    width: `${(rect.width / pageSize.width) * 100}%`,
    height: `${(rect.height / pageSize.height) * 100}%`,
  };
}
