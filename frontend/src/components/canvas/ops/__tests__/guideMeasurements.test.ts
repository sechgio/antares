import { describe, expect, it } from 'vitest';
import {
  boxesOverlapOnAxis,
  measureGuideDistances,
  measureHoverGap,
  measureSelectionGaps,
} from '../guideMeasurements';

const PAGE = { widthMm: 210, heightMm: 297 };
const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('boxesOverlapOnAxis', () => {
  it('detecta solape real y rechaza bordes solo en contacto', () => {
    expect(boxesOverlapOnAxis(0, 10, 5, 15)).toBe(true);
    expect(boxesOverlapOnAxis(0, 10, 10, 20)).toBe(false);
    expect(boxesOverlapOnAxis(0, 10, 20, 30)).toBe(false);
  });
});

describe('measureGuideDistances', () => {
  it('emite distancias a los bordes de página en eje x', () => {
    const labels = measureGuideDistances('x', 50, [], PAGE);
    const left = labels.find((l) => l.id === 'guide-page-left')!;
    const right = labels.find((l) => l.id === 'guide-page-right')!;
    expect(left.valueMm).toBe(50);
    expect(left.x1).toBe(0);
    expect(left.x2).toBe(50);
    expect(right.valueMm).toBe(160);
    expect(right.x1).toBe(50);
    expect(right.x2).toBe(210);
  });

  it('en eje y usa alto de página y etiquetas top/bottom', () => {
    const labels = measureGuideDistances('y', 100, [], PAGE);
    expect(labels.find((l) => l.id === 'guide-page-top')!.valueMm).toBe(100);
    expect(labels.find((l) => l.id === 'guide-page-bottom')!.valueMm).toBe(197);
  });

  it('omite la etiqueta de página cuando la guía está en el borde', () => {
    const labels = measureGuideDistances('x', 0, [], PAGE);
    expect(labels.find((l) => l.id === 'guide-page-left')).toBeUndefined();
    expect(labels.find((l) => l.id === 'guide-page-right')!.valueMm).toBe(210);
  });

  it('mide al borde de objeto más cercano a cada lado de la guía', () => {
    const box = rect(10, 20, 30, 40); // bordes x en 10 y 40
    const labels = measureGuideDistances('x', 50, [box], PAGE);
    const objLeft = labels.find((l) => l.id === 'guide-object-left')!;
    expect(objLeft.x1).toBe(40);
    expect(objLeft.x2).toBe(50);
    expect(objLeft.valueMm).toBe(10);
    expect(objLeft.y).toBe(40); // centro vertical de la caja
  });

  it('con varias cajas elige el borde más cercano', () => {
    const near = rect(30, 0, 10, 10); // borde derecho en 40
    const far = rect(0, 0, 10, 10); // borde derecho en 10
    const labels = measureGuideDistances('x', 50, [far, near], PAGE);
    expect(labels.find((l) => l.id === 'guide-object-left')!.valueMm).toBe(10);
  });

  it('caja a la derecha de la guía produce guide-object-right', () => {
    const box = rect(80, 5, 20, 20); // borde izquierdo en 80
    const labels = measureGuideDistances('x', 50, [box], PAGE);
    const objRight = labels.find((l) => l.id === 'guide-object-right')!;
    expect(objRight.x1).toBe(50);
    expect(objRight.x2).toBe(80);
    expect(objRight.valueMm).toBe(30);
  });
});

describe('measureSelectionGaps', () => {
  it('emite los 4 huecos a página para una selección centrada', () => {
    const sel = rect(50, 100, 20, 30);
    const labels = measureSelectionGaps(sel, [], PAGE);
    const byId = new Map(labels.map((l) => [l.id, l]));
    expect(byId.get('page-left')!.valueMm).toBe(50);
    expect(byId.get('page-right')!.valueMm).toBe(140);
    expect(byId.get('page-top')!.valueMm).toBe(100);
    expect(byId.get('page-bottom')!.valueMm).toBe(167);
  });

  it('omite huecos nulos cuando la selección toca el borde', () => {
    const labels = measureSelectionGaps(rect(0, 0, 50, 50), [], PAGE);
    const ids = labels.map((l) => l.id);
    expect(ids).not.toContain('page-left');
    expect(ids).not.toContain('page-top');
    expect(ids).toContain('page-right');
    expect(ids).toContain('page-bottom');
  });

  it('mide hueco horizontal solo con cajas que solapan en Y', () => {
    const sel = rect(50, 50, 20, 20);
    const aligned = rect(100, 55, 20, 20); // solapa en Y, separada en X
    const offAxis = rect(100, 200, 20, 20); // no solapa en Y
    const labels = measureSelectionGaps(sel, [aligned, offAxis], PAGE);
    const obj = labels.find((l) => l.id === 'obj-right')!;
    expect(obj.valueMm).toBe(30);
    expect(obj.x1).toBe(70);
    expect(obj.x2).toBe(100);
    expect(labels.filter((l) => l.id.startsWith('obj-x-') && l.id.includes('200'))).toEqual([]);
  });

  it('mide hueco vertical entre selección y caja debajo', () => {
    const sel = rect(50, 50, 20, 20);
    const below = rect(55, 100, 20, 20);
    const labels = measureSelectionGaps(sel, [below], PAGE);
    const obj = labels.find((l) => l.id === 'obj-bottom')!;
    expect(obj.valueMm).toBe(30);
    expect(obj.y1).toBe(70);
    expect(obj.y2).toBe(100);
  });

  it('no emite hueco de objeto si las cajas se tocan', () => {
    const sel = rect(50, 50, 20, 20);
    const touching = rect(70, 50, 20, 20); // x2 de sel = 70 = x de touching
    const labels = measureSelectionGaps(sel, [touching], PAGE);
    expect(labels.find((l) => l.id === 'obj-right')).toBeUndefined();
  });
});

describe('measureHoverGap', () => {
  it('sin target delega a huecos de página', () => {
    const sel = rect(50, 50, 20, 20);
    const labels = measureHoverGap(sel, null, PAGE);
    expect(labels.map((l) => l.id)).toEqual(
      measureSelectionGaps(sel, [], PAGE).map((l) => l.id),
    );
  });

  it('target separado a la derecha produce hover-x con el gap', () => {
    const sel = rect(50, 50, 20, 20);
    const target = rect(100, 50, 20, 20);
    const labels = measureHoverGap(sel, target, PAGE);
    const gap = labels.find((l) => l.id === 'hover-x')!;
    expect(gap.valueMm).toBe(30);
    expect(gap.x1).toBe(70);
    expect(gap.x2).toBe(100);
    // solapan en Y → sin hover-y de gap
    expect(labels.find((l) => l.id === 'hover-y')).toBeUndefined();
  });

  it('target separado a la izquierda invierte los extremos', () => {
    const sel = rect(100, 50, 20, 20);
    const target = rect(50, 50, 20, 20);
    const labels = measureHoverGap(sel, target, PAGE);
    const gap = labels.find((l) => l.id === 'hover-x')!;
    expect(gap.x1).toBe(70);
    expect(gap.x2).toBe(100);
    expect(gap.valueMm).toBe(30);
  });

  it('target solapado en X emite deltas de bordes en vez de gap', () => {
    const sel = rect(50, 50, 20, 20);
    const target = rect(55, 50, 25, 20); // desplazado 5 en x, 10 más ancho
    const labels = measureHoverGap(sel, target, PAGE);
    expect(labels.find((l) => l.id === 'hover-x')).toBeUndefined();
    expect(labels.find((l) => l.id === 'hover-x-left')!.valueMm).toBe(5);
    expect(labels.find((l) => l.id === 'hover-x-right')!.valueMm).toBe(10);
  });

  it('target separado en Y produce hover-y', () => {
    const sel = rect(50, 50, 20, 20);
    const target = rect(50, 110, 20, 20);
    const labels = measureHoverGap(sel, target, PAGE);
    const gap = labels.find((l) => l.id === 'hover-y')!;
    expect(gap.valueMm).toBe(40);
    expect(gap.y1).toBe(70);
    expect(gap.y2).toBe(110);
  });

  it('target idéntico no emite etiquetas', () => {
    const sel = rect(50, 50, 20, 20);
    expect(measureHoverGap(sel, { ...sel }, PAGE)).toEqual([]);
  });
});
