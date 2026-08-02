import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { applyAnchoredResize, applyParentConstraint, parseResizeAnchor, RESIZE_ANCHORS } from '../resizeConstraints';
import { mm, parseMm } from '../../types';

describe('applyParentConstraint', () => {
  const child = () =>
    createLayer('rect', {
      cssVars: {
        '--width': mm(40),
        '--height': mm(20),
        '--translate-x': mm(30),
        '--translate-y': mm(40),
      },
    });

  it('start only translates by dx/dy and keeps size', () => {
    const next = applyParentConstraint(child(), { dx: 5, dy: 7, dw: 20, dh: 10 }, 'start', 'start');
    expect(parseMm(next.cssVars['--translate-x'])).toBe(35);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(47);
    expect(parseMm(next.cssVars['--width'])).toBe(40);
    expect(parseMm(next.cssVars['--height'])).toBe(20);
  });

  it('end translates by dx and grows size by dw/dh (pins end edge)', () => {
    const next = applyParentConstraint(child(), { dx: 5, dy: 7, dw: 20, dh: 10 }, 'end', 'end');
    expect(parseMm(next.cssVars['--translate-x'])).toBe(35);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(47);
    expect(parseMm(next.cssVars['--width'])).toBe(60);
    expect(parseMm(next.cssVars['--height'])).toBe(30);
  });

  it('undefined axis constraint leaves that axis unchanged', () => {
    const next = applyParentConstraint(child(), { dx: 5, dy: 7, dw: 20, dh: 10 }, 'start', undefined);
    expect(parseMm(next.cssVars['--translate-x'])).toBe(35);
    expect(parseMm(next.cssVars['--width'])).toBe(40);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(40);
    expect(parseMm(next.cssVars['--height'])).toBe(20);
  });

  it('center translates by half the size delta', () => {
    const next = applyParentConstraint(child(), { dx: 0, dy: 0, dw: 20, dh: 10 }, 'center', 'center');
    expect(parseMm(next.cssVars['--translate-x'])).toBe(40);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(45);
    expect(parseMm(next.cssVars['--width'])).toBe(40);
    expect(parseMm(next.cssVars['--height'])).toBe(20);
  });

  it('scale scales position and size proportional to dw/dh', () => {
    // Parent was 100×50 at (10,10); grows to 200×100 (dw=100, dh=50), origin fixed.
    const parentBefore = { x: 10, y: 10, w: 100, h: 50 };
    const next = applyParentConstraint(
      child(),
      { dx: 0, dy: 0, dw: 100, dh: 50 },
      'scale',
      'scale',
      parentBefore,
    );
    // relX = 30-10 = 20 → 20*2 = 40 → x' = 10+40 = 50; w' = 40*2 = 80
    expect(parseMm(next.cssVars['--translate-x'])).toBe(50);
    expect(parseMm(next.cssVars['--width'])).toBe(80);
    // relY = 40-10 = 30 → 30*2 = 60 → y' = 10+60 = 70; h' = 20*2 = 40
    expect(parseMm(next.cssVars['--translate-y'])).toBe(70);
    expect(parseMm(next.cssVars['--height'])).toBe(40);
  });
});

describe('applyAnchoredResize (manual anchor still works)', () => {
  it('keeps legacy 9-point anchors', () => {
    expect(RESIZE_ANCHORS).toHaveLength(9);
    expect(parseResizeAnchor(undefined)).toBe('tl');
    const layer = createLayer('rect', {
      cssVars: {
        '--width': '100mm',
        '--height': '50mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
      },
    });
    const next = applyAnchoredResize(layer, { w: 200 }, 'tl');
    expect(next.cssVars['--translate-x']).toBe('10mm');
  });
});
