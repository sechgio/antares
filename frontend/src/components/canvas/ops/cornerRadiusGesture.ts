import type { CanvasLayer } from '../types';
import { parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';
import { type CornerId, cornerRadiusPx } from './layerStyle';
import { replaceLayerById } from './patchLayers';
import { clipPathForLayerType } from './shapePaths';

export function layerSupportsCornerRadius(layer: CanvasLayer): boolean {
  return !clipPathForLayerType(layer.type) && layer.type !== 'line';
}

export function maxCornerRadiusPx(wMm: number, hMm: number): number {
  const wPx = Math.max(0, wMm) * MM_TO_PX;
  const hPx = Math.max(0, hMm) * MM_TO_PX;
  return Math.min(wPx, hPx) / 2;
}

export function maxCornerRadiusPxForLayer(layer: CanvasLayer): number {
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  return maxCornerRadiusPx(w, h);
}

export const RADIUS_HANDLE_MIN_INSET_SCREEN = 14;

export function radiusHandleInsetPx(
  radiusPx: number,
  cameraZoom = 1,
  minInsetScreen = RADIUS_HANDLE_MIN_INSET_SCREEN,
): number {
  const z = cameraZoom > 0 ? cameraZoom : 1;
  const minInset = minInsetScreen / z;
  return Math.max(0, radiusPx, minInset);
}

export function projectRadiusDelta(corner: CornerId, dxPx: number, dyPx: number): number {
  const invSqrt2 = 1 / Math.SQRT2;
  switch (corner) {
    case 'tl':
      return (dxPx + dyPx) * invSqrt2;
    case 'tr':
      return (-dxPx + dyPx) * invSqrt2;
    case 'br':
      return (-dxPx - dyPx) * invSqrt2;
    case 'bl':
      return (dxPx - dyPx) * invSqrt2;
  }
}

export function clampCornerRadiusPx(radiusPx: number, maxPx: number): number {
  if (!Number.isFinite(radiusPx)) return 0;
  return Math.max(0, Math.min(maxPx, radiusPx));
}

export function computeRadiusFromDrag(
  startRadiusPx: number,
  corner: CornerId,
  dxPx: number,
  dyPx: number,
  maxPx: number,
): number {
  return clampCornerRadiusPx(startRadiusPx + projectRadiusDelta(corner, dxPx, dyPx), maxPx);
}

export function applyCornerRadiusDrag(
  layer: CanvasLayer,
  corner: CornerId,
  nextRadiusPx: number,
  options: { independent: boolean },
): CanvasLayer {
  const max = maxCornerRadiusPxForLayer(layer);
  const r = clampCornerRadiusPx(nextRadiusPx, max);
  const value = `${Math.round(r * 100) / 100}px`;
  const cssVars = { ...layer.cssVars };

  if (options.independent) {
    for (const c of ['tl', 'tr', 'br', 'bl'] as const) {
      const key = `--radius-${c}` as const;
      if (!cssVars[key]) {
        cssVars[key] = `${cornerRadiusPx(layer.cssVars, c)}px`;
      }
    }
    cssVars[`--radius-${corner}`] = value;
    delete cssVars['--border-radius'];
  } else {
    cssVars['--border-radius'] = value;
    delete cssVars['--radius-tl'];
    delete cssVars['--radius-tr'];
    delete cssVars['--radius-br'];
    delete cssVars['--radius-bl'];
  }

  return { ...layer, cssVars };
}

export function layersWithCornerRadius(
  layers: CanvasLayer[],
  id: string,
  corner: CornerId,
  nextRadiusPx: number,
  options: { independent: boolean },
): CanvasLayer[] {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return layers;
  return replaceLayerById(layers, applyCornerRadiusDrag(layer, corner, nextRadiusPx, options));
}
