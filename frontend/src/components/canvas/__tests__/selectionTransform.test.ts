import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { applyGridToImageSlots } from '../ops/gridLayout';
import { MM_TO_PX } from '../ops/drawHelpers';
import {
  constrainMoveToAxis,
  isPointerClick,
  layersInMarquee,
  moveSelection,
  POINTER_CLICK_PX,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  SNAP_THRESHOLD_MAX_MM,
  snapMoveWithGuides,
  snapRectToGrid,
  snapThresholdMm,
  snapToGridMm,
  type HandlePos,
} from '../ops/selectionTransform';
import { parseMm } from '../types';

describe('selectionTransform', () => {
  it('snapThresholdMm scales with zoom but caps at low zoom', () => {
    const at1 = snapThresholdMm(1, 5);
    const at2 = snapThresholdMm(2, 5);
    expect(at1).toBeCloseTo(5 / MM_TO_PX, 5);
    expect(at2).toBeCloseTo(at1 / 2, 5);
    expect(snapThresholdMm(0.02, 5)).toBe(SNAP_THRESHOLD_MAX_MM);
    expect(snapThresholdMm(0.05, 5)).toBeLessThanOrEqual(SNAP_THRESHOLD_MAX_MM);
  });

  it('snapToGridMm and snapRectToGrid align to step', () => {
    expect(snapToGridMm(12.4, 5)).toBe(10);
    expect(snapToGridMm(12.6, 5)).toBe(15);
    expect(snapRectToGrid({ x: 12.4, y: 7.6, w: 10.2, h: 8.1 }, 5)).toEqual({
      x: 10,
      y: 10,
      w: 15,
      h: 5,
    });
  });

  it('isPointerClick treats small travel as click', () => {
    expect(isPointerClick(0, 0)).toBe(true);
    expect(isPointerClick(POINTER_CLICK_PX, 0)).toBe(true);
    expect(isPointerClick(POINTER_CLICK_PX + 1, 0)).toBe(false);
    expect(isPointerClick(2, 2)).toBe(true);
    expect(isPointerClick(10, 10)).toBe(false);
  });

  it('constrainMoveToAxis locks to the dominant axis when Shift-like lock is on', () => {
    expect(constrainMoveToAxis(10, 3, false)).toEqual({ dx: 10, dy: 3 });
    expect(constrainMoveToAxis(10, 3, true)).toEqual({ dx: 10, dy: 0 });
    expect(constrainMoveToAxis(3, 10, true)).toEqual({ dx: 0, dy: 10 });
    expect(constrainMoveToAxis(-8, 8, true)).toEqual({ dx: -8, dy: 0 });
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

  it('layersInMarquee uses rotated AABB', () => {
    const rotated = createLayer('rect', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '20mm',
        '--height': '10mm',
        '--rotate': '90deg',
      },
    });
    expect(layersInMarquee([rotated], { x: 0, y: 12, w: 10, h: 4 })).toEqual([rotated.id]);
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

  it('selectionBounds includes rotated AABB', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '20mm',
        '--height': '10mm',
        '--rotate': '90deg',
      },
    });
    const bounds = selectionBounds([layer], [layer.id])!;
    expect(bounds.w).toBeCloseTo(10, 5);
    expect(bounds.h).toBeCloseTo(20, 5);
  });

  it('resizeSelection fromCenter grows symmetrically', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const next = resizeSelection([layer], [layer.id], 'e', 5, 0, { fromCenter: true });
    const moved = next.find((l) => l.id === layer.id)!;
    expect(parseMm(moved.cssVars['--width'])).toBeCloseTo(30, 5);
    expect(parseMm(moved.cssVars['--translate-x'])).toBeCloseTo(5, 5);
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

  it('resizeSelection scales group descendants with the group box', () => {
    const group = createLayer('group', {
      id: 'g1',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '40mm',
        '--height': '20mm',
        '--background-color': 'transparent',
      },
    });
    const child = createLayer('rect', {
      id: 'c1',
      parentId: 'g1',
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const next = resizeSelection([group, child], ['g1'], 'e', 40, 0, { aspectLock: false });
    expect(parseMm(next.find((l) => l.id === 'g1')!.cssVars['--width'])).toBeCloseTo(80, 5);
    expect(parseMm(next.find((l) => l.id === 'c1')!.cssVars['--translate-x'])).toBeCloseTo(30, 5);
    expect(parseMm(next.find((l) => l.id === 'c1')!.cssVars['--width'])).toBeCloseTo(40, 5);
  });

  it('rotateSelection rotates group descendants around selection center', () => {
    const group = createLayer('group', {
      id: 'g1',
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '40mm',
        '--height': '20mm',
        '--background-color': 'transparent',
      },
    });
    const child = createLayer('rect', {
      id: 'c1',
      parentId: 'g1',
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '0mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const next = rotateSelection([group, child], ['g1'], 90);
    const g = next.find((l) => l.id === 'g1')!;
    const c = next.find((l) => l.id === 'c1')!;
    expect(g.cssVars['--rotate']).toBe('90deg');
    expect(c.cssVars['--rotate']).toBe('90deg');
    expect(parseMm(c.cssVars['--translate-x'])).toBeCloseTo(10, 5);
    expect(parseMm(c.cssVars['--translate-y'])).toBeCloseTo(10, 5);
  });

  it('resizeSelection relayouts grid image slots into the new box', () => {
    const grid = createLayer('grid', {
      meta: { cols: 2, rows: 2, gapMm: 2 },
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '100mm',
        '--height': '80mm',
      },
    });
    const slots = [0, 1, 2, 3].map((i) =>
      createLayer('imageSlot', {
        parentId: grid.id,
        meta: { index: i },
        cssVars: {
          '--translate-x': '10mm',
          '--translate-y': '10mm',
          '--width': '40mm',
          '--height': '30mm',
        },
      }),
    );
    const before = applyGridToImageSlots([grid, ...slots], grid.id);
    const slotBefore = before.find((l) => l.parentId === grid.id && l.meta?.index === 1)!;
    const next = resizeSelection(before, [grid.id], 'se', 40, 20, { aspectLock: false });
    const gridNext = next.find((l) => l.id === grid.id)!;
    const slotAfter = next.find((l) => l.id === slotBefore.id)!;
    expect(parseMm(gridNext.cssVars['--width'])).toBeCloseTo(140, 5);
    expect(parseMm(gridNext.cssVars['--height'])).toBeCloseTo(100, 5);
    expect(parseMm(slotAfter.cssVars['--translate-x'])).toBeGreaterThan(
      parseMm(slotBefore.cssVars['--translate-x']),
    );
    expect(parseMm(slotAfter.cssVars['--width'])).toBeGreaterThan(
      parseMm(slotBefore.cssVars['--width']),
    );
  });

  it('resizeSelection of one grid imageSlot does not change sibling slots', () => {
    const grid = createLayer('grid', {
      meta: { cols: 2, rows: 2, gapMm: 0 },
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '100mm',
        '--height': '80mm',
      },
    });
    const slots = [0, 1, 2, 3].map((i) =>
      createLayer('imageSlot', {
        parentId: grid.id,
        meta: { index: i },
      }),
    );
    const before = applyGridToImageSlots([grid, ...slots], grid.id);
    const left = before.find((l) => l.parentId === grid.id && l.meta?.index === 0)!;
    const right = before.find((l) => l.parentId === grid.id && l.meta?.index === 1)!;
    const bottomLeft = before.find((l) => l.parentId === grid.id && l.meta?.index === 2)!;
    const rightBefore = {
      x: parseMm(right.cssVars['--translate-x']),
      y: parseMm(right.cssVars['--translate-y']),
      w: parseMm(right.cssVars['--width']),
      h: parseMm(right.cssVars['--height']),
    };
    const bottomLeftBefore = {
      x: parseMm(bottomLeft.cssVars['--translate-x']),
      y: parseMm(bottomLeft.cssVars['--translate-y']),
      w: parseMm(bottomLeft.cssVars['--width']),
      h: parseMm(bottomLeft.cssVars['--height']),
    };

    const next = resizeSelection(before, [left.id], 'e', 20, 0, { aspectLock: false });
    const leftAfter = next.find((l) => l.id === left.id)!;
    const rightAfter = next.find((l) => l.id === right.id)!;
    const bottomLeftAfter = next.find((l) => l.id === bottomLeft.id)!;
    const gridAfter = next.find((l) => l.id === grid.id)!;

    expect(parseMm(leftAfter.cssVars['--width'])).toBeCloseTo(70, 5);
    expect(parseMm(rightAfter.cssVars['--translate-x'])).toBeCloseTo(rightBefore.x, 5);
    expect(parseMm(rightAfter.cssVars['--translate-y'])).toBeCloseTo(rightBefore.y, 5);
    expect(parseMm(rightAfter.cssVars['--width'])).toBeCloseTo(rightBefore.w, 5);
    expect(parseMm(rightAfter.cssVars['--height'])).toBeCloseTo(rightBefore.h, 5);
    expect(parseMm(bottomLeftAfter.cssVars['--translate-x'])).toBeCloseTo(bottomLeftBefore.x, 5);
    expect(parseMm(bottomLeftAfter.cssVars['--width'])).toBeCloseTo(bottomLeftBefore.w, 5);
    expect(parseMm(bottomLeftAfter.cssVars['--height'])).toBeCloseTo(bottomLeftBefore.h, 5);
    expect(parseMm(gridAfter.cssVars['--width'])).toBeCloseTo(100, 5);
  });

  it('resizeSelection scales path points on line layers without changing stroke weight', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '80mm',
        '--height': '2mm',
        '--border-width': '2px',
      },
      meta: {
        path: {
          points: [
            { x: 0, y: 1 },
            { x: 80, y: 1 },
          ],
          closed: false,
        },
      },
    });
    const next = resizeSelection([line], [line.id], 'e', 40, 0, { aspectLock: false });
    const resized = next.find((l) => l.id === line.id)!;
    expect(parseMm(resized.cssVars['--width'])).toBeCloseTo(120, 5);
    expect(resized.cssVars['--border-width']).toBe('2px');
    expect(resized.meta?.path?.points[1].x).toBeCloseTo(120, 5);
  });
});
