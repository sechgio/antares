import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  isPointerClick,
  layersInMarquee,
  moveSelection,
  POINTER_CLICK_PX,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  snapMoveWithGuides,
  type HandlePos,
} from '../ops/selectionTransform';
import { parseMm } from '../types';

describe('selectionTransform', () => {
  it('isPointerClick treats small travel as click', () => {
    expect(isPointerClick(0, 0)).toBe(true);
    expect(isPointerClick(POINTER_CLICK_PX, 0)).toBe(true);
    expect(isPointerClick(POINTER_CLICK_PX + 1, 0)).toBe(false);
    expect(isPointerClick(2, 2)).toBe(true);
    expect(isPointerClick(10, 10)).toBe(false);
  });

  it('moveSelection allows negative coordinates (free canvas)', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '5mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    const moved = moveSelection([layer], [layer.id], -18, -12);
    const next = moved.find((l) => l.id === layer.id)!;
    expect(parseMm(next.cssVars['--translate-x'])).toBe(-8);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(-7);
  });

  it('selectionBounds unions selected layers', () => {
    const a = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--width': '30mm',
        '--height': '10mm',
      },
    });
    const b = createLayer('rect', {
      cssVars: {
        '--translate-x': '50mm',
        '--translate-y': '40mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const bounds = selectionBounds([a, b], [a.id, b.id]);
    expect(bounds).toEqual({ x: 10, y: 20, w: 60, h: 40 });
  });

  it('layersInMarquee returns intersecting unlocked layers', () => {
    const a = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const b = createLayer('rect', {
      cssVars: {
        '--translate-x': '100mm',
        '--translate-y': '100mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const locked = createLayer('rect', {
      locked: true,
      cssVars: {
        '--translate-x': '12mm',
        '--translate-y': '12mm',
        '--width': '5mm',
        '--height': '5mm',
      },
    });
    const ids = layersInMarquee([a, b, locked], { x: 5, y: 5, w: 30, h: 30 });
    expect(ids).toEqual([a.id]);
  });

  it('resizeSelection se grows width/height; Shift locks aspect', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '40mm',
        '--height': '20mm',
      },
    });
    const free = resizeSelection([layer], [layer.id], 'se', 20, 10, { aspectLock: false });
    const grown = free.find((l) => l.id === layer.id)!;
    expect(parseMm(grown.cssVars['--width'])).toBeCloseTo(60, 5);
    expect(parseMm(grown.cssVars['--height'])).toBeCloseTo(30, 5);

    const locked = resizeSelection([layer], [layer.id], 'se', 20, 0, { aspectLock: true });
    const aspect = locked.find((l) => l.id === layer.id)!;
    expect(parseMm(aspect.cssVars['--width'])).toBeCloseTo(60, 5);
    expect(parseMm(aspect.cssVars['--height'])).toBeCloseTo(30, 5);
  });

  it('rotateSelection adds degrees; Shift snaps to 15°', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '20mm',
        '--rotate': '0deg',
      },
    });
    const rotated = rotateSelection([layer], [layer.id], 22, { snap15: true });
    const next = rotated.find((l) => l.id === layer.id)!;
    expect(next.cssVars['--rotate']).toBe('15deg');
  });

  it('snapMoveWithGuides snaps to neighbor edge within threshold', () => {
    const moving = createLayer('rect', {
      cssVars: {
        '--translate-x': '48mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    const other = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    // Moving left edge is at 48; other right edge at 30. dx=-17.7 → left at 30.3, snaps to 30.
    const result = snapMoveWithGuides(
      [moving, other],
      [moving.id],
      -17.7,
      0,
      { widthMm: 210, heightMm: 297 },
      0.5,
    );
    expect(result.dx).toBeCloseTo(-18, 5);
    expect(result.guides.some((g) => g.axis === 'x')).toBe(true);
  });

  it('resizeSelection scales multiple layers relative to group bbox', () => {
    const a = createLayer('rect', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const b = createLayer('rect', {
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '0mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const next = resizeSelection([a, b], [a.id, b.id], 'e' as HandlePos, 20, 0, { aspectLock: false });
    expect(parseMm(next.find((l) => l.id === a.id)!.cssVars['--width'])).toBeCloseTo(30, 5);
    expect(parseMm(next.find((l) => l.id === b.id)!.cssVars['--translate-x'])).toBeCloseTo(30, 5);
    expect(parseMm(next.find((l) => l.id === b.id)!.cssVars['--width'])).toBeCloseTo(30, 5);
  });
});
