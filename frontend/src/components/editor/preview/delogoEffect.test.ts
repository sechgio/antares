import { describe, it, expect } from 'vitest';
import {
  draftToRects,
  hitTest,
  isDegenerate,
  moveRect,
  normalizeRect,
  rectInsideFrame,
  resizeRect,
  screenRectToSource,
  screenToSource,
  sourceToScreen,
} from './delogoEffect';
import type { DelogoRect } from '../types';

function rect(overrides: Partial<DelogoRect> = {}): DelogoRect {
  return { id: 'r1', x: 0.1, y: 0.1, width: 0.2, height: 0.2, ...overrides };
}

describe('efecto delogo de preview', () => {
  it('convierte pantalla a origen normalizado', () => {
    expect(screenToSource(320, 240, { width: 640, height: 480 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('convierte origen a pantalla', () => {
    expect(sourceToScreen(0.5, 0.5, { width: 640, height: 480 })).toEqual({ x: 320, y: 240 });
  });

  it('el zoom de UI no cambia la selección persistida', () => {
    // La misma región relativa (10%..30%) en dos tamaños de viewport
    // con la misma relación de aspecto produce la misma máscara.
    const small = screenRectToSource({ x: 32, y: 24, width: 64, height: 48 }, { width: 320, height: 240 });
    const large = screenRectToSource({ x: 128, y: 96, width: 256, height: 192 }, { width: 1280, height: 960 });
    expect(small.x).toBeCloseTo(large.x, 6);
    expect(small.y).toBeCloseTo(large.y, 6);
    expect(small.width).toBeCloseTo(large.width, 6);
    expect(small.height).toBeCloseTo(large.height, 6);
  });

  it('normaliza rectángulos invertidos', () => {
    const normalized = normalizeRect({ id: 'r', x: -0.2, y: 1.5, width: 2, height: 2 });
    expect(normalized.x).toBe(0);
    expect(normalized.y).toBe(1);
    expect(normalized.width).toBe(1);
  });

  it('acota valores no finitos a 0', () => {
    const normalized = normalizeRect({ id: 'r', x: NaN, y: Infinity, width: 1, height: 1 });
    expect(normalized.x).toBe(0);
    expect(normalized.y).toBe(0);
  });

  it('detecta máscaras degeneradas', () => {
    expect(isDegenerate(rect({ width: 0.01, height: 0.2 }))).toBe(true);
    expect(isDegenerate(rect())).toBe(false);
  });

  it('valida que la máscara quepa en el fotograma', () => {
    expect(rectInsideFrame(rect())).toBe(true);
    expect(rectInsideFrame(rect({ x: 0.9, width: 0.3 }))).toBe(false);
    expect(rectInsideFrame(rect({ y: 0.9, height: 0.3 }))).toBe(false);
  });

  it('con margen rechaza el borde exacto', () => {
    expect(rectInsideFrame({ id: 'r', x: 0, y: 0, width: 1, height: 1 }, 1)).toBe(false);
    expect(rectInsideFrame({ id: 'r', x: 0, y: 0, width: 0.9, height: 0.9 }, 1)).toBe(true);
  });

  it('mueve la máscara acotando al fotograma', () => {
    const moved = moveRect(rect({ x: 0.9, width: 0.1 }), 0.5, 0);
    expect(moved.x + moved.width).toBeLessThanOrEqual(1);
    const back = moveRect(rect({ x: 0, width: 0.1 }), -0.5, 0);
    expect(back.x).toBe(0);
  });

  it('redimensiona sin negativos', () => {
    const shrunk = resizeRect(rect({ width: 0.1 }), -0.5, 0);
    expect(shrunk.width).toBe(0);
    const grown = resizeRect(rect(), 0.1, 0.1);
    expect(grown.width).toBeCloseTo(0.3, 6);
  });

  it('hit test devuelve el rectángulo superior', () => {
    const rects = [rect({ id: 'abajo' }), rect({ id: 'arriba', x: 0.15, y: 0.15, width: 0.1, height: 0.1 })];
    expect(hitTest(rects, 0.18, 0.18)?.id).toBe('arriba');
    expect(hitTest(rects, 0.12, 0.12)?.id).toBe('abajo');
  });

  it('hit test fuera de las máscaras devuelve null', () => {
    expect(hitTest([rect()], 0.9, 0.9)).toBeNull();
  });

  it('convierte borrador a máscaras con ids', () => {
    const rects = draftToRects([
      { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
    ]);
    expect(rects.map((r) => r.id)).toEqual(['mask-1', 'mask-2']);
    expect(rects[1].x).toBe(0.5);
  });
});
