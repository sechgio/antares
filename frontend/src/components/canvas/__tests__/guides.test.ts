import { describe, expect, it } from 'vitest';
import {
  clampGuidePos,
  clearGuides,
  collectReferenceGaps,
  createGuide,
  formatGapMm,
  formatSizeMm,
  guidesForPage,
  isGuideRemovalPoint,
  measureHoverGap,
  measureGuideDistances,
  measureSelectionGaps,
  moveGuide,
  removeGuide,
  snapEqualGaps,
  upsertGuide,
} from '../ops/guides';
import { MIN_GUIDE_GAP_MM } from '../ops/guideMeasurements';
import {
  prepareSnapRails,
  snapGuidePosition,
  snapMoveWithGuides,
  snapThresholdMm,
} from '../ops/selectionTransform';
import { createEmptyDocument, resolvePageMarginMm, DEFAULT_PAGE_MARGIN_MM } from '../types';
import { createLayer } from '../constants';
import { MM_TO_PX } from '../ops/drawHelpers';

function collectReferenceGapsByPairScan(
  others: Array<{ x: number; y: number; w: number; h: number }>,
  page: { widthMm: number; heightMm: number },
) {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const other of others) {
    if (other.x > MIN_GUIDE_GAP_MM) xs.add(other.x);
    const rightGap = page.widthMm - (other.x + other.w);
    if (rightGap > MIN_GUIDE_GAP_MM) xs.add(rightGap);
    if (other.y > MIN_GUIDE_GAP_MM) ys.add(other.y);
    const bottomGap = page.heightMm - (other.y + other.h);
    if (bottomGap > MIN_GUIDE_GAP_MM) ys.add(bottomGap);
  }
  const overlaps = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(a0, b0) < Math.min(a1, b1);
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i]!;
      const b = others[j]!;
      if (overlaps(a.y, a.y + a.h, b.y, b.y + b.h)) {
        const gap = b.x - (a.x + a.w);
        if (gap > MIN_GUIDE_GAP_MM) xs.add(gap);
      }
      if (overlaps(a.x, a.x + a.w, b.x, b.x + b.w)) {
        const gap = b.y - (a.y + a.h);
        if (gap > MIN_GUIDE_GAP_MM) ys.add(gap);
      }
    }
  }
  return { x: [...xs], y: [...ys] };
}

describe('guides', () => {
  it('upsertGuide adds and updates by id', () => {
    let doc = createEmptyDocument();
    const g = createGuide('x', 42, 0);
    doc = upsertGuide(doc, g);
    expect(doc.guides).toHaveLength(1);
    doc = upsertGuide(doc, { ...g, posMm: 55 });
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides![0].posMm).toBe(55);
  });

  it('guidesForPage filters by pageIndex', () => {
    let doc = createEmptyDocument();
    doc = upsertGuide(doc, createGuide('x', 10, 0));
    doc = upsertGuide(doc, createGuide('y', 20, 1));
    expect(guidesForPage(doc, 0)).toHaveLength(1);
    expect(guidesForPage(doc, 1)).toHaveLength(1);
  });

  it('moveGuide and removeGuide', () => {
    let doc = createEmptyDocument();
    const g = createGuide('y', 30, 0);
    doc = upsertGuide(doc, g);
    doc = moveGuide(doc, g.id, 40);
    expect(doc.guides![0].posMm).toBe(40);
    doc = removeGuide(doc, g.id);
    expect(doc.guides).toHaveLength(0);
  });

  it('clearGuides vacía todas las páginas y es idempotente', () => {
    let doc = createEmptyDocument();
    expect(clearGuides(doc)).toBe(doc);
    doc = upsertGuide(doc, createGuide('x', 10, 0));
    doc = upsertGuide(doc, createGuide('y', 20, 1));
    const cleared = clearGuides(doc);
    expect(cleared.guides).toEqual([]);
    expect(clearGuides(cleared)).toBe(cleared);
  });

  it('measureSelectionGaps reports page and object gaps', () => {
    const selection = { x: 20, y: 20, w: 10, h: 10 };
    const other = { x: 50, y: 20, w: 10, h: 10 };
    const labels = measureSelectionGaps(selection, [other], { widthMm: 210, heightMm: 297 });
    expect(labels.some((l) => l.id === 'page-left')).toBe(true);
    expect(labels.some((l) => l.id === 'obj-right' && Math.abs(l.valueMm - 20) < 0.01)).toBe(true);
  });

  it('measureGuideDistances reports page edges and the nearest object edges', () => {
    const labels = measureGuideDistances(
      'x',
      45,
      [
        { x: 20, y: 30, w: 10, h: 10 },
        { x: 60, y: 50, w: 20, h: 10 },
      ],
      { widthMm: 210, heightMm: 297 },
    );

    expect(labels.find((label) => label.id === 'guide-page-left')?.valueMm).toBe(45);
    expect(labels.find((label) => label.id === 'guide-page-right')?.valueMm).toBe(165);
    expect(labels.find((label) => label.id === 'guide-object-left')?.valueMm).toBe(15);
    expect(labels.find((label) => label.id === 'guide-object-right')?.valueMm).toBe(15);
  });

  it('formatGapMm', () => {
    expect(formatGapMm(10)).toBe('10 mm');
    expect(formatGapMm(10.25)).toBe('10.3 mm');
  });

  it('formatSizeMm', () => {
    expect(formatSizeMm(40, 12)).toBe('40 × 12');
    expect(formatSizeMm(40.25, 12.04)).toBe('40.3 × 12');
  });

  it('snapMoveWithGuides snaps to manual guide', () => {
    const moving = createLayer('rect', {
      cssVars: {
        '--translate-x': '48mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    const guide = createGuide('x', 30, 0);
    const result = snapMoveWithGuides(
      [moving],
      [moving.id],
      -17.7,
      0,
      { widthMm: 210, heightMm: 297 },
      0.5,
      [guide],
    );
    expect(result.dx).toBeCloseTo(-18, 5);
    expect(result.guides.some((g) => g.axis === 'x' && g.pos === 30)).toBe(true);
  });

  it('snapThresholdMm scales with zoom', () => {
    const at1 = snapThresholdMm(1, 5);
    const at2 = snapThresholdMm(2, 5);
    expect(at1).toBeCloseTo(5 / MM_TO_PX, 5);
    expect(at2).toBeCloseTo(at1 / 2, 5);
    expect(snapThresholdMm(0.02, 5)).toBeLessThan(5 / (MM_TO_PX * 0.02));
  });

  it('clampGuidePos clamps to the page extent', () => {
    expect(clampGuidePos(-5, 210)).toBe(0);
    expect(clampGuidePos(42.5, 210)).toBe(42.5);
    expect(clampGuidePos(999, 210)).toBe(210);
  });

  it('isGuideRemovalPoint detects the ruler strip per axis', () => {
    const rect = { left: 100, top: 50 };
    expect(isGuideRemovalPoint('x', 100 + 20 + 3, 400, rect, 20)).toBe(true);
    expect(isGuideRemovalPoint('x', 100 + 20 + 4, 400, rect, 20)).toBe(false);
    expect(isGuideRemovalPoint('x', 500, 10, rect, 20)).toBe(false);
    expect(isGuideRemovalPoint('y', 500, 50 + 20 + 3, rect, 20)).toBe(true);
    expect(isGuideRemovalPoint('y', 500, 50 + 20 + 4, rect, 20)).toBe(false);
  });

  it('resolvePageMarginMm defaults to 10 and allows 0', () => {
    expect(resolvePageMarginMm(undefined)).toBe(DEFAULT_PAGE_MARGIN_MM);
    expect(resolvePageMarginMm({})).toBe(DEFAULT_PAGE_MARGIN_MM);
    expect(resolvePageMarginMm({ pageMarginMm: 0 })).toBe(0);
    expect(resolvePageMarginMm({ pageMarginMm: 15 })).toBe(15);
  });

  it('prepareSnapRails includes page margin rails', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '50mm',
        '--translate-y': '50mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const rails = prepareSnapRails([layer], [layer.id], { widthMm: 210, heightMm: 297 }, [], 10);
    expect(rails.xs).toContain(10);
    expect(rails.xs).toContain(200);
    expect(rails.ys).toContain(10);
    expect(rails.ys).toContain(287);
  });

  it('snapGuidePosition aligns a manual guide to the nearest object rail', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '50mm',
        '--translate-y': '70mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    const rails = prepareSnapRails([layer], [], { widthMm: 210, heightMm: 297 });

    expect(snapGuidePosition('x', 49.4, rails, 1)).toEqual({ posMm: 50, snapped: true });
    expect(snapGuidePosition('y', 74.3, rails, 1)).toEqual({ posMm: 75, snapped: true });
    expect(snapGuidePosition('x', 47, rails, 1)).toEqual({ posMm: 47, snapped: false });
  });

  it('snapEqualGaps snaps a third rect to match an 8mm sibling gap', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const b = { x: 38, y: 10, w: 20, h: 10 };
    const movingOrigin = { x: 70, y: 10, w: 20, h: 10 };
    const result = snapEqualGaps(
      movingOrigin,
      -3.7,
      0,
      [a, b],
      { widthMm: 210, heightMm: 297 },
      0.5,
      collectReferenceGaps([a, b], { widthMm: 210, heightMm: 297 }),
    );
    expect(result.dx).toBeCloseTo(-4, 5);
    expect(result.labels.some((l) => l.axis === 'x' && Math.abs(l.valueMm - 8) < 0.01)).toBe(true);
  });

  it('collects the same ordered reference gaps when rectangles are duplicated', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const b = { x: 38, y: 10, w: 20, h: 10 };
    const c = { x: 70, y: 30, w: 20, h: 10 };
    const page = { widthMm: 210, heightMm: 297 };

    expect(collectReferenceGaps([a, b, { ...a }, c, { ...b }], page)).toEqual(
      collectReferenceGaps([a, b, c], page),
    );
  });

  it('preserves exhaustive reference gaps and order for mixed geometry', () => {
    const page = { widthMm: 210, heightMm: 297 };

    for (let seed = 0; seed < 24; seed++) {
      const rects = Array.from({ length: 24 }, (_, index) => ({
        x: ((index * 37 + seed * 11) % 31) - 5,
        y: ((index * 19 + seed * 7) % 23) - 3,
        w: (index + seed) % 7 === 0 ? 0 : 1 + ((index + seed) % 4),
        h: (index + seed) % 9 === 0 ? 0 : 1 + ((index + seed) % 5),
      }));
      const withDuplicates = rects.flatMap((rect, index) =>
        index % 3 === 0 ? [rect, { ...rect }] : [rect],
      );

      expect(collectReferenceGaps(withDuplicates, page)).toEqual(
        collectReferenceGapsByPairScan(withDuplicates, page),
      );
    }
  });

  it('keeps duplicate-heavy reference gap setup within budget', () => {
    const rect = { x: 10, y: 10, w: 20, h: 10 };
    const duplicates = Array.from({ length: 6_000 }, () => ({ ...rect }));
    const start = performance.now();
    const gaps = collectReferenceGaps(duplicates, { widthMm: 210, heightMm: 297 });

    expect(gaps).toEqual(collectReferenceGaps([rect], { widthMm: 210, heightMm: 297 }));
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('keeps dense unique grid reference gap setup within budget', () => {
    const rects = Array.from({ length: 3_000 }, (_, index) => ({
      x: (index % 50) * 4,
      y: Math.floor(index / 50) * 4,
      w: 2,
      h: 2,
    }));
    const start = performance.now();
    const gaps = collectReferenceGaps(rects, { widthMm: 210, heightMm: 297 });

    expect(gaps.x.length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('preserves ordered reference gaps for equidistant rows in either direction', () => {
    const page = { widthMm: 210, heightMm: 297 };
    const ascending = Array.from({ length: 24 }, (_, index) => ({
      x: index * 2,
      y: 20,
      w: 1,
      h: 10,
    }));
    const descending = Array.from({ length: 24 }, (_, index) => ({
      x: (23 - index) * 2,
      y: 20,
      w: 1,
      h: 10,
    }));

    expect(collectReferenceGaps(ascending, page)).toEqual(
      collectReferenceGapsByPairScan(ascending, page),
    );
    expect(collectReferenceGaps(descending, page)).toEqual(
      collectReferenceGapsByPairScan(descending, page),
    );
  });

  it('keeps a dense equidistant row reference-gap setup under budget', () => {
    const rects = Array.from({ length: 6_000 }, (_, index) => ({
      x: index * 2,
      y: 20,
      w: 1,
      h: 10,
    }));
    const start = performance.now();
    const gaps = collectReferenceGaps(rects, { widthMm: 210, heightMm: 297 });

    expect(gaps.x).toContain(11_997);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('preserves reference insertion order when two gap sizes are equally near', () => {
    const result = snapEqualGaps(
      { x: 50, y: 10, w: 10, h: 10 },
      0,
      0,
      [{ x: 20, y: 10, w: 17.5, h: 10 }],
      { widthMm: 500, heightMm: 500 },
      2,
      { x: [14, 11], y: [] },
    );

    expect(result.dx).toBe(1.5);
    expect(result.labels[0]?.valueMm).toBe(14);
  });

  it('measureHoverGap measures gap to a separated layer', () => {
    const sel = { x: 20, y: 20, w: 10, h: 10 };
    const target = { x: 60, y: 25, w: 10, h: 10 };
    const labels = measureHoverGap(sel, target, { widthMm: 210, heightMm: 297 });
    const xGap = labels.find((l) => l.id === 'hover-x');
    expect(xGap).toBeTruthy();
    expect(xGap!.valueMm).toBeCloseTo(30, 5);
    const yGap = labels.find((l) => l.id === 'hover-y');
    expect(yGap).toBeUndefined();
  });

  it('measureHoverGap omits the gap label when boxes only touch', () => {
    const sel = { x: 20, y: 20, w: 10, h: 10 };
    const target = { x: 30, y: 20, w: 10, h: 10 };
    const labels = measureHoverGap(sel, target, { widthMm: 210, heightMm: 297 });
    expect(labels.find((l) => l.id === 'hover-x')).toBeUndefined();
  });

  it('measureHoverGap reports edge deltas when overlapping on an axis', () => {
    const sel = { x: 20, y: 20, w: 10, h: 10 };
    const target = { x: 25, y: 20, w: 15, h: 10 };
    const labels = measureHoverGap(sel, target, { widthMm: 210, heightMm: 297 });
    const left = labels.find((l) => l.id === 'hover-x-left');
    const right = labels.find((l) => l.id === 'hover-x-right');
    expect(left!.valueMm).toBeCloseTo(5, 5);
    expect(right!.valueMm).toBeCloseTo(10, 5);
  });

  it('measureHoverGap falls back to page distances without a target', () => {
    const sel = { x: 20, y: 20, w: 10, h: 10 };
    const labels = measureHoverGap(sel, null, { widthMm: 210, heightMm: 297 });
    expect(labels.some((l) => l.id === 'page-left')).toBe(true);
    expect(labels.some((l) => l.id === 'page-right')).toBe(true);
    expect(labels.some((l) => l.id.startsWith('hover-'))).toBe(false);
  });

  it('measureHoverGap omits aligned edges', () => {
    const sel = { x: 20, y: 20, w: 10, h: 10 };
    const target = { x: 20, y: 60, w: 10, h: 10 };
    const labels = measureHoverGap(sel, target, { widthMm: 210, heightMm: 297 });
    expect(labels.filter((l) => l.axis === 'x')).toHaveLength(0);
    expect(labels.find((l) => l.id === 'hover-y')!.valueMm).toBeCloseTo(30, 5);
  });

  it('measureSelectionGaps measures all consecutive gaps in a multi-object sequence', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const sel = { x: 40, y: 10, w: 20, h: 10 };
    const c = { x: 75, y: 10, w: 20, h: 10 };
    const labels = measureSelectionGaps(sel, [a, c], { widthMm: 210, heightMm: 297 });

    const xGaps = labels.filter((l) => l.axis === 'x');
    expect(xGaps.some((l) => Math.abs(l.valueMm - 10) < 0.01)).toBe(true);
    expect(xGaps.some((l) => Math.abs(l.valueMm - 15) < 0.01)).toBe(true);
  });

  it('snapEqualGaps highlights all matching equal gaps in the sequence', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const b = { x: 45, y: 10, w: 20, h: 10 };
    const movingOrigin = { x: 80.2, y: 10, w: 20, h: 10 };
    const result = snapEqualGaps(
      movingOrigin,
      -0.2,
      0,
      [a, b],
      { widthMm: 210, heightMm: 297 },
      0.5,
      collectReferenceGaps([a, b], { widthMm: 210, heightMm: 297 }),
    );
    expect(result.dx).toBeCloseTo(-0.2, 5);
    const matched15mm = result.labels.filter((l) => l.axis === 'x' && Math.abs(l.valueMm - 15) < 0.1);
    expect(matched15mm.length).toBeGreaterThanOrEqual(2);
  });
});
