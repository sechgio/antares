import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  applyLivePanelLayerChange,
  gridSlotLayoutMetaChanged,
} from '../ops/gridLayout';
import { isOpenDocumentDirty } from '../hooks/useCanvasSync';
import { parseMm } from '../types';

describe('isOpenDocumentDirty', () => {
  it('is dirty when has unsaved edits', () => {
    expect(isOpenDocumentDirty(true, false, false)).toBe(true);
  });

  it('is dirty when panel baseline is active', () => {
    expect(isOpenDocumentDirty(false, true, false)).toBe(true);
  });

  it('is dirty when gesture baseline is active', () => {
    expect(isOpenDocumentDirty(false, false, true)).toBe(true);
  });

  it('is dirty when rename baseline is active', () => {
    expect(isOpenDocumentDirty(false, false, false, true)).toBe(true);
  });

  it('is clean when undo history alone would have been true but unsaved is false', () => {
    expect(isOpenDocumentDirty(false, false, false)).toBe(false);
  });
});

describe('gridSlotLayoutMetaChanged', () => {
  it('is false when only position-unrelated meta is unchanged', () => {
    expect(
      gridSlotLayoutMetaChanged(
        { cols: 2, rows: 2, gapMm: 2 },
        { cols: 2, rows: 2, gapMm: 2 },
      ),
    ).toBe(false);
  });

  it('is true when cols/rows/gapMm change', () => {
    expect(
      gridSlotLayoutMetaChanged({ cols: 2, rows: 2, gapMm: 2 }, { cols: 3, rows: 2, gapMm: 2 }),
    ).toBe(true);
    expect(
      gridSlotLayoutMetaChanged({ cols: 2, rows: 2, gapMm: 2 }, { cols: 2, rows: 3, gapMm: 2 }),
    ).toBe(true);
    expect(
      gridSlotLayoutMetaChanged({ cols: 2, rows: 2, gapMm: 2 }, { cols: 2, rows: 2, gapMm: 4 }),
    ).toBe(true);
  });
});

describe('applyLivePanelLayerChange', () => {
  it('moving grid X does not relocate child slots', () => {
    const gridId = 'g1';
    const slot = createLayer('imageSlot', {
      id: 's1',
      parentId: gridId,
      meta: { index: 0 },
      cssVars: {
        '--width': '48mm',
        '--height': '38mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const grid = createLayer('grid', {
      id: gridId,
      meta: { cols: 2, rows: 2, gapMm: 2 },
      cssVars: {
        '--width': '100mm',
        '--height': '80mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const layers = [
      grid,
      slot,
      createLayer('imageSlot', { id: 's2', parentId: gridId, meta: { index: 1 } }),
      createLayer('imageSlot', { id: 's3', parentId: gridId, meta: { index: 2 } }),
      createLayer('imageSlot', { id: 's4', parentId: gridId, meta: { index: 3 } }),
    ];
    const movedGrid: typeof grid = {
      ...grid,
      cssVars: { ...grid.cssVars, '--translate-x': '30mm' },
    };
    const next = applyLivePanelLayerChange(layers, grid, movedGrid);
    const nextSlot = next.find((l) => l.id === 's1')!;
    expect(parseMm(nextSlot.cssVars['--translate-x'])).toBe(0);
    expect(parseMm(next.find((l) => l.id === gridId)!.cssVars['--translate-x'])).toBe(30);
  });

  it('changing cols rebuilds and moves child slots', () => {
    const gridId = 'g1';
    const grid = createLayer('grid', {
      id: gridId,
      meta: { cols: 2, rows: 1, gapMm: 2 },
      cssVars: {
        '--width': '100mm',
        '--height': '40mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const layers = [
      grid,
      createLayer('imageSlot', {
        id: 's1',
        parentId: gridId,
        meta: { index: 0 },
        cssVars: {
          '--width': '49mm',
          '--height': '40mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      }),
      createLayer('imageSlot', {
        id: 's2',
        parentId: gridId,
        meta: { index: 1 },
        cssVars: {
          '--width': '49mm',
          '--height': '40mm',
          '--translate-x': '51mm',
          '--translate-y': '0mm',
        },
      }),
    ];
    const nextGrid: typeof grid = {
      ...grid,
      meta: { ...grid.meta, cols: 3, rows: 1, gapMm: 2 },
    };
    const next = applyLivePanelLayerChange(layers, grid, nextGrid);
    const slots = next.filter((l) => l.parentId === gridId && l.type === 'imageSlot');
    expect(slots).toHaveLength(3);
    expect(parseMm(slots[1]!.cssVars['--translate-x'])).toBeGreaterThan(0);
  });

  it('lock/visibility toggles do not rebuild or move child slots', () => {
    const gridId = 'g1';
    const grid = createLayer('grid', {
      id: gridId,
      meta: { cols: 2, rows: 2, gapMm: 2 },
      cssVars: {
        '--width': '100mm',
        '--height': '80mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const slot = createLayer('imageSlot', {
      id: 's1',
      parentId: gridId,
      meta: { index: 0 },
      cssVars: {
        '--width': '30mm',
        '--height': '20mm',
        '--translate-x': '19mm',
        '--translate-y': '19mm',
      },
    });
    const layers = [
      grid,
      slot,
      createLayer('imageSlot', { id: 's2', parentId: gridId, meta: { index: 1 } }),
      createLayer('imageSlot', { id: 's3', parentId: gridId, meta: { index: 2 } }),
      createLayer('imageSlot', { id: 's4', parentId: gridId, meta: { index: 3 } }),
    ];
    const lockedGrid: typeof grid = { ...grid, locked: true };
    const next = applyLivePanelLayerChange(layers, grid, lockedGrid);
    const nextSlot = next.find((l) => l.id === 's1')!;
    expect(parseMm(nextSlot.cssVars['--width'])).toBeCloseTo(30, 5);
    expect(parseMm(nextSlot.cssVars['--height'])).toBeCloseTo(20, 5);
    expect(parseMm(nextSlot.cssVars['--translate-x'])).toBeCloseTo(19, 5);
    expect(parseMm(nextSlot.cssVars['--translate-y'])).toBeCloseTo(19, 5);
    expect(next.find((l) => l.id === gridId)!.locked).toBe(true);
  });
});
