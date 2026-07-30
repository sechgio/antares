import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { buildSpatialIndex } from '../ops/spatialIndex';

/** Helper: a normal rect layer at the given mm position/size. */
function rectLayer(id: string, x: number, y: number, w = 20, h = 20) {
  const layer = createLayer('rect', { name: id });
  layer.id = id;
  layer.cssVars['--translate-x'] = `${x}mm`;
  layer.cssVars['--translate-y'] = `${y}mm`;
  layer.cssVars['--width'] = `${w}mm`;
  layer.cssVars['--height'] = `${h}mm`;
  return layer;
}

describe('buildSpatialIndex', () => {
  it('returns empty query/hitTest for no layers', () => {
    const idx = buildSpatialIndex([]);
    expect(idx.query({ x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
    expect(idx.hitTest(50, 50)).toEqual([]);
  });

  it('query returns ids whose bbox overlaps the rect', () => {
    const a = rectLayer('a', 0, 0);
    const b = rectLayer('b', 100, 100);
    const c = rectLayer('c', 200, 200);
    const idx = buildSpatialIndex([a, b, c]);
    // Query a rect covering the origin — only `a` overlaps.
    expect(idx.query({ x: 0, y: 0, w: 30, h: 30 })).toEqual(['a']);
    // Query a rect covering the whole area — all three overlap (z-order preserved).
    expect(idx.query({ x: -10, y: -10, w: 250, h: 250 })).toEqual(['a', 'b', 'c']);
  });

  it('hitTest returns ids at the point, top-most (last) first', () => {
    // Two overlapping layers at the origin; `b` is later in the array (top-most).
    const a = rectLayer('a', 0, 0);
    const b = rectLayer('b', 0, 0);
    const idx = buildSpatialIndex([a, b]);
    const hits = idx.hitTest(5, 5);
    expect(hits[0]).toBe('b');
    expect(hits[1]).toBe('a');
  });

  it('hitTest returns [] for a point in an empty cell', () => {
    const a = rectLayer('a', 0, 0);
    const idx = buildSpatialIndex([a]);
    expect(idx.hitTest(500, 500)).toEqual([]);
  });

  it('excludes frame, hidden, and locked layers', () => {
    const frame = createLayer('rect');
    frame.type = 'frame';
    frame.cssVars['--translate-x'] = '0mm';
    frame.cssVars['--translate-y'] = '0mm';
    frame.cssVars['--width'] = '20mm';
    frame.cssVars['--height'] = '20mm';

    const hidden = rectLayer('hidden', 0, 0);
    hidden.visible = false;

    const locked = rectLayer('locked', 0, 0);
    locked.locked = true;

    const normal = rectLayer('normal', 0, 0);

    const idx = buildSpatialIndex([frame, hidden, locked, normal]);
    expect(idx.query({ x: 0, y: 0, w: 25, h: 25 })).toEqual(['normal']);
    expect(idx.hitTest(5, 5)).toEqual(['normal']);
  });

  it('indexes a layer spanning multiple cells in every overlapping cell', () => {
    // A 50mm layer starting at 0 should touch cells 0,1,2 on each axis.
    const big = rectLayer('big', 0, 0, 50, 50);
    const idx = buildSpatialIndex([big]);
    // Querying a small rect in cell (40,40) should still find `big`.
    expect(idx.query({ x: 40, y: 40, w: 5, h: 5 })).toEqual(['big']);
    // hitTest at (45,45) — inside the layer but in a different cell from origin.
    expect(idx.hitTest(45, 45)).toEqual(['big']);
  });

  it('indexes rotated AABB so hitTest catches corners outside the local box', () => {
    // 20×10 at origin, rotated 90° → visual AABB ~10×20 centered on (10,5).
    const rotated = rectLayer('rot', 0, 0, 20, 10);
    rotated.cssVars['--rotate'] = '90deg';
    const idx = buildSpatialIndex([rotated]);
    // Inside rotated AABB (y up to ~15) but outside unrotated local box (y≤10).
    expect(idx.hitTest(5, 12)).toEqual(['rot']);
    expect(idx.query({ x: 0, y: 12, w: 10, h: 4 })).toEqual(['rot']);
  });
});
