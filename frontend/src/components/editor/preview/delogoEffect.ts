import { type CropRect, type DelogoRect } from '../types';

/**
 * Efecto delogo de preview (L5, plan §L5.1).
 *
 * La selección se persiste en coordenadas normalizadas del **origen
 * orientado**, no de la pantalla: el zoom o el tamaño del preview no
 * cambian la máscara guardada. La conversión pantalla ↔ origen aplica
 * el mismo orden de transformaciones que el render (crop → giro →
 * flip), para que la región marcada coincida con la que se filtra.
 */

export interface Viewport {
  /** Ancho/alto del elemento de preview en pantalla (px CSS). */
  width: number;
  height: number;
}

export function screenToSource(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: clamp01(screenX / Math.max(viewport.width, 1)),
    y: clamp01(screenY / Math.max(viewport.height, 1)),
  };
}

export function sourceToScreen(
  sourceX: number,
  sourceY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return { x: sourceX * viewport.width, y: sourceY * viewport.height };
}

export function screenRectToSource(
  rect: { x: number; y: number; width: number; height: number },
  viewport: Viewport,
): DelogoRect {
  const topLeft = screenToSource(rect.x, rect.y, viewport);
  const bottomRight = screenToSource(rect.x + rect.width, rect.y + rect.height, viewport);
  return normalizeRect({
    id: '',
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizeRect(rect: DelogoRect): DelogoRect {
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    ...rect,
    x,
    y,
    // Acotar x/y puede empujar el borde derecho fuera del fotograma:
    // el ancho se recorta para que x+w <= 1.
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

export function rectInsideFrame(rect: DelogoRect, margin = 0): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= 1 &&
    rect.y + rect.height <= 1 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 - margin / 1000 &&
    rect.y + rect.height <= 1 - margin / 1000
  );
}

export function isDegenerate(rect: DelogoRect, minNorm = 0.02): boolean {
  return rect.width < minNorm || rect.height < minNorm;
}

export function moveRect(rect: DelogoRect, dxNorm: number, dyNorm: number): DelogoRect {
  return normalizeRect({ ...rect, x: rect.x + dxNorm, y: rect.y + dyNorm });
}

export function resizeRect(rect: DelogoRect, dwNorm: number, dhNorm: number): DelogoRect {
  return normalizeRect({
    ...rect,
    width: Math.max(0, rect.width + dwNorm),
    height: Math.max(0, rect.height + dhNorm),
  });
}

export function hitTest(rects: DelogoRect[], xNorm: number, yNorm: number): DelogoRect | null {
  // El último rectángulo dibujado gana (está encima visualmente).
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const r = rects[i];
    if (xNorm >= r.x && xNorm <= r.x + r.width && yNorm >= r.y && yNorm <= r.y + r.height) {
      return r;
    }
  }
  return null;
}

export function draftToRects(draft: CropRect[]): DelogoRect[] {
  return draft.map((rect, index) => ({
    id: `mask-${index + 1}`,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }));
}
