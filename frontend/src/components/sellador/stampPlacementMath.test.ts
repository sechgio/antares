import { describe, expect, it } from 'vitest';
import {
  clientPointToPdfPoint,
  computeDragRect,
  computeDropRect,
  rectToOverlayPercent,
} from './stampPlacementMath';
import type { PdfPageSize, StampRect } from './types';

const page: PdfPageSize = { width: 612, height: 792 };
const rect: StampRect = { x: 100, y: 200, width: 120, height: 60 };

describe('clientPointToPdfPoint', () => {
  it('mapea esquina superior-izquierda a (0,0)', () => {
    const bounds = { left: 50, top: 100, width: 400, height: 300 };
    expect(clientPointToPdfPoint(50, 100, bounds, page)).toEqual({ x: 0, y: 0 });
  });

  it('escala proporcionalmente al tamaño de página', () => {
    const bounds = { left: 0, top: 0, width: 306, height: 396 };
    expect(clientPointToPdfPoint(153, 198, bounds, page)).toEqual({ x: 306, y: 396 });
  });

  it('bounds nulos o degenerados devuelven origen', () => {
    expect(clientPointToPdfPoint(10, 10, null, page)).toEqual({ x: 0, y: 0 });
    expect(clientPointToPdfPoint(10, 10, { left: 0, top: 0, width: 0, height: 10 }, page)).toEqual({ x: 0, y: 0 });
  });
});

describe('computeDragRect', () => {
  const start = { x: 50, y: 50 };

  it('move traslada el rect por el delta', () => {
    const out = computeDragRect('move', rect, start, { x: 80, y: 30 }, page);
    expect(out).toEqual({ x: 130, y: 180, width: 120, height: 60 });
  });

  it('move clampa al borde de página', () => {
    const out = computeDragRect('move', rect, start, { x: 50, y: -9999 }, page);
    expect(out.y).toBe(0);
  });

  it('resize ajusta width y preserva aspect', () => {
    const out = computeDragRect('resize', rect, start, { x: 300, y: 0 }, page);
    // nextWidth = 300-100 = 200, aspect = 2 → height = 100
    expect(out).toEqual({ x: 100, y: 200, width: 200, height: 100 });
  });

  it('resize respeta el mínimo MIN_STAMP_SIZE en ambos ejes', () => {
    const out = computeDragRect('resize', rect, start, { x: 50, y: 0 }, page);
    // nextWidth=24 → height=12, pero clampStampRect fuerza mínimo 24
    expect(out.width).toBe(24);
    expect(out.height).toBe(24);
  });
});

describe('computeDropRect', () => {
  it('centra el rect sobre el punto de drop', () => {
    const out = computeDropRect(rect, { x: 300, y: 400 }, page);
    expect(out.x).toBe(300 - 60);
    expect(out.y).toBe(400 - 30);
    expect(out.width).toBe(120);
    expect(out.height).toBe(60);
  });
});

describe('rectToOverlayPercent', () => {
  it('convierte a porcentajes de la página', () => {
    const out = rectToOverlayPercent({ x: 153, y: 198, width: 153, height: 198 }, page);
    expect(out.left).toBe('25%');
    expect(out.top).toBe('25%');
    expect(out.width).toBe('25%');
    expect(out.height).toBe('25%');
  });
});
