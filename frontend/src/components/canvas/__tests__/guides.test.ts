import { describe, expect, it } from 'vitest';
import {
  createGuide,
  formatGapMm,
  guidesForPage,
  measureSelectionGaps,
  moveGuide,
  removeGuide,
  upsertGuide,
} from '../ops/guides';
import { snapMoveWithGuides, snapThresholdMm } from '../ops/selectionTransform';
import { createEmptyDocument } from '../types';
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
  });
});
