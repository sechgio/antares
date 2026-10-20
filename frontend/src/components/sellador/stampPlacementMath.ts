import type { PdfPageSize, StampDragMode, StampRect } from './types';
import { clampStampRect } from './utils';

interface ClientBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

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
