import { describe, expect, it } from 'vitest';
import {
  clampGuidePos,
  collectReferenceGaps,
  createGuide,
  formatGapMm,
  formatSizeMm,
  guidesForPage,
  isGuideRemovalPoint,
  measureSelectionGaps,
  moveGuide,
  removeGuide,
  snapEqualGaps,
  upsertGuide,
} from '../ops/guides';
import { prepareSnapRails, snapMoveWithGuides, snapThresholdMm } from '../ops/selectionTransform';
import { createEmptyDocument, resolvePageMarginMm, DEFAULT_PAGE_MARGIN_MM } from '../types';
import { createLayer } from '../constants';
import { MM_TO_PX } from '../ops/drawHelpers';

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

  it('measureSelectionGaps reports page and object gaps', () => {
    const selection = { x: 20, y: 20, w: 10, h: 10 };
    const other = { x: 50, y: 20, w: 10, h: 10 };
    const labels = measureSelectionGaps(selection, [other], { widthMm: 210, heightMm: 297 });
    expect(labels.some((l) => l.id === 'page-left')).toBe(true);
    expect(labels.some((l) => l.id === 'obj-right' && Math.abs(l.valueMm - 20) < 0.01)).toBe(true);
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
    // left edge at 48, dx=-17.7 → 30.3, snaps to guide at 30
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
    // Low zoom is capped (see SNAP_THRESHOLD_MAX_MM in selectionTransform).
    expect(snapThresholdMm(0.02, 5)).toBeLessThan(5 / (MM_TO_PX * 0.02));
  });

  it('clampGuidePos clamps to the page extent', () => {
    expect(clampGuidePos(-5, 210)).toBe(0);
    expect(clampGuidePos(42.5, 210)).toBe(42.5);
    expect(clampGuidePos(999, 210)).toBe(210);
  });

  it('isGuideRemovalPoint detects the ruler strip per axis', () => {
    const rect = { left: 100, top: 50 };
    // Vertical guide (axis x) removes over the left ruler strip.
    expect(isGuideRemovalPoint('x', 100 + 20 + 3, 400, rect, 20)).toBe(true);
    expect(isGuideRemovalPoint('x', 100 + 20 + 4, 400, rect, 20)).toBe(false);
    expect(isGuideRemovalPoint('x', 500, 10, rect, 20)).toBe(false);
    // Horizontal guide (axis y) removes over the top ruler strip.
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

  it('snapEqualGaps snaps a third rect to match an 8mm sibling gap', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const b = { x: 38, y: 10, w: 20, h: 10 }; // gap 8mm after a
    const movingOrigin = { x: 70, y: 10, w: 20, h: 10 };
    // Drag left so gap to b is ~8.3 → snap to 8
    const result = snapEqualGaps(
      movingOrigin,
      -3.7,
      0,
      [a, b],
      { widthMm: 210, heightMm: 297 },
      0.5,
      collectReferenceGaps([a, b], { widthMm: 210, heightMm: 297 }),
    );
    // After snap: moving.x = b.right + 8 = 58+8 = 66 → dx = 66 - 70 = -4
    expect(result.dx).toBeCloseTo(-4, 5);
    expect(result.labels.some((l) => l.axis === 'x' && Math.abs(l.valueMm - 8) < 0.01)).toBe(true);
  });

  it('measureSelectionGaps measures all consecutive gaps in a multi-object sequence', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 };
    const sel = { x: 40, y: 10, w: 20, h: 10 }; // gap 10mm from a
    const c = { x: 75, y: 10, w: 20, h: 10 }; // gap 15mm from sel
    const labels = measureSelectionGaps(sel, [a, c], { widthMm: 210, heightMm: 297 });

    // Should measure both A-sel gap (10mm) and sel-C gap (15mm)
    const xGaps = labels.filter((l) => l.axis === 'x');
    expect(xGaps.some((l) => Math.abs(l.valueMm - 10) < 0.01)).toBe(true);
    expect(xGaps.some((l) => Math.abs(l.valueMm - 15) < 0.01)).toBe(true);
  });

  it('snapEqualGaps highlights all matching equal gaps in the sequence', () => {
    const a = { x: 10, y: 10, w: 20, h: 10 }; // right edge = 30
    const b = { x: 45, y: 10, w: 20, h: 10 }; // left = 45, gap = 15mm after a, right = 65
    const movingOrigin = { x: 80.2, y: 10, w: 20, h: 10 }; // gap ~15.2mm from b
    // Drag left to position at x=80 (gap 15mm from b)
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
    // Should contain equal gap labels for both A-B and B-moving
    const matched15mm = result.labels.filter((l) => l.axis === 'x' && Math.abs(l.valueMm - 15) < 0.1);
    expect(matched15mm.length).toBeGreaterThanOrEqual(2);
  });
});
