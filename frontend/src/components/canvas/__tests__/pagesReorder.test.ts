import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type CanvasLayer } from '../types';
import { createLayer } from '../constants';
import { moveLayersToPage, reorderPage } from '../ops/pages';

function layerOn(pageIndex: number, id: string, parentId?: string): CanvasLayer {
  return { ...createLayer('rect', { id }), pageIndex, parentId };
}

describe('reorderPage', () => {
  it('reorders pages and remaps layer/guide pageIndex', () => {
    const doc = createEmptyDocument('Doc');
    doc.pages = [
      { id: 'p0', name: 'Uno' },
      { id: 'p1', name: 'Dos' },
      { id: 'p2', name: 'Tres' },
    ];
    doc.layers = [layerOn(0, 'a'), layerOn(1, 'b'), layerOn(2, 'c')];
    doc.guides = [
      { id: 'g0', axis: 'x', posMm: 10, pageIndex: 0 },
      { id: 'g2', axis: 'x', posMm: 20, pageIndex: 2 },
    ];

    const next = reorderPage(doc, 0, 2);

    expect(next.pages?.map((p) => p.name)).toEqual(['Dos', 'Tres', 'Uno']);
    const byId = new Map(next.layers.map((l) => [l.id, l]));
    expect(byId.get('a')!.pageIndex).toBe(2);
    expect(byId.get('b')!.pageIndex).toBe(0);
    expect(byId.get('c')!.pageIndex).toBe(1);
    const guidesById = new Map((next.guides ?? []).map((g) => [g.id, g]));
    expect(guidesById.get('g0')!.pageIndex).toBe(2);
    expect(guidesById.get('g2')!.pageIndex).toBe(1);
  });

  it('is a no-op for same index or out-of-range targets', () => {
    const doc = createEmptyDocument('Doc');
    doc.pages = [{ id: 'p0', name: 'Uno' }, { id: 'p1', name: 'Dos' }];
    expect(reorderPage(doc, 0, 0)).toBe(doc);
    expect(reorderPage(doc, -1, 1)).toBe(doc);
    expect(reorderPage(doc, 0, 5)).toBe(doc);
  });
});

describe('moveLayersToPage', () => {
  it('moves selected layers and their descendants to the target page', () => {
    const doc = createEmptyDocument('Doc');
    doc.pages = [{ id: 'p0', name: 'Uno' }, { id: 'p1', name: 'Dos' }];
    doc.layers = [
      layerOn(0, 'group'),
      layerOn(0, 'child', 'group'),
      layerOn(0, 'stay'),
    ];

    const next = moveLayersToPage(doc, ['group'], 1);

    const byId = new Map(next.layers.map((l) => [l.id, l]));
    expect(byId.get('group')!.pageIndex).toBe(1);
    expect(byId.get('child')!.pageIndex).toBe(1);
    expect(byId.get('stay')!.pageIndex).toBe(0);
  });

  it('does not move frames and no-ops when already on the page', () => {
    const doc = createEmptyDocument('Doc');
    doc.pages = [{ id: 'p0', name: 'Uno' }, { id: 'p1', name: 'Dos' }];
    doc.layers = [layerOn(1, 'already')];

    expect(moveLayersToPage(doc, ['already'], 1)).toBe(doc);
    expect(moveLayersToPage(doc, [], 0)).toBe(doc);
    expect(moveLayersToPage(doc, ['already'], 9)).toBe(doc);
  });
});
