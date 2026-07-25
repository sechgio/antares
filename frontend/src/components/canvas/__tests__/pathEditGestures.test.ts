import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { lineStrokeWidthPx } from '../ops/layerStyle';
import { bendLineAt, cutLineAt, BEND_HIT_MM } from '../ops/pathEditGestures';
import { parseMm } from '../types';

describe('pathEditGestures', () => {
  it('bendLineAt adds handles near the segment midpoint', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '100mm',
        '--height': '2mm',
      },
      meta: {
        path: { points: [{ x: 0, y: 1 }, { x: 100, y: 1 }], closed: false },
      },
    });
    const bent = bendLineAt(line, 50, 1 - 10);
    expect(bent.meta?.path?.points[0].hout).toBeTruthy();
    expect(bent.meta?.path?.points[1].hin).toBeTruthy();
  });

  it('bendLineAt ignores pointers farther than BEND_HIT_MM', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
      meta: {
        path: { points: [{ x: 0, y: 1 }, { x: 100, y: 1 }], closed: false },
      },
    });
    const unchanged = bendLineAt(line, 50, 1 + BEND_HIT_MM + 5);
    expect(unchanged.meta?.path?.points[0].hout).toBeFalsy();
  });

  it('cutLineAt returns two line layers sharing stroke weight', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--border-width': '3px',
      },
      meta: {
        path: { points: [{ x: 0, y: 1 }, { x: 80, y: 1 }], closed: false },
      },
    });
    const split = cutLineAt(line, 10 + 40, 20 + 1);
    expect(split).not.toBeNull();
    const [left, right] = split!;
    expect(left.id).toBe(line.id);
    expect(right.id).not.toBe(line.id);
    expect(lineStrokeWidthPx(left)).toBe(3);
    expect(lineStrokeWidthPx(right)).toBe(3);
    expect(left.meta?.path?.points.length).toBeGreaterThanOrEqual(2);
    expect(right.meta?.path?.points.length).toBeGreaterThanOrEqual(2);
    expect(parseMm(left.cssVars['--translate-x'])).toBeGreaterThanOrEqual(10);
  });
});
