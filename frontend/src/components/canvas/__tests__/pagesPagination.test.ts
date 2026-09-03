import { describe, expect, it } from 'vitest';
import { planMultiPageRender } from '../runtime/planning';
import { createEmptyDocument, newId, type CanvasDocument } from '../types';
import type { FillContext } from '../runtime/renderHtml';

function slot(pageIndex: number, index: number) {
  return {
    id: newId(),
    type: 'imageSlot' as const,
    name: `Foto ${index + 1}`,
    value: '',
    pageIndex,
    meta: { index },
    cssVars: { '--width': '40mm', '--height': '40mm', '--translate-x': '0mm', '--translate-y': '0mm' },
  };
}

function ctx(n: number): FillContext {
  return {
    data: {},
    images: Array.from({ length: n }, (_, i) => `img-${i}`),
    logoLeft: null,
    logoRight: null,
  };
}

describe('planMultiPageRender photo pagination', () => {
  it('paginates by page-0 slots when page 0 has imageSlots', () => {
    const doc = createEmptyDocument('Slots');
    doc.layers = [doc.layers[0]!, ...Array.from({ length: 4 }, (_, i) => slot(0, i))];
    const plan = planMultiPageRender(doc, ctx(9));
    expect(plan).toHaveLength(3);
    expect(plan[0]!.pageCtx.images).toHaveLength(4);
    expect(plan[1]!.pageCtx.images).toHaveLength(4);
    expect(plan[2]!.pageCtx.images).toHaveLength(1);
  });

  it('skips cover without slots; chunks land on first slot page', () => {
    const doc = createEmptyDocument('Cover');
    doc.pages = [
      { id: newId(), name: 'Portada' },
      { id: newId(), name: 'Fotos' },
    ];
    doc.settings = { imagesPerPage: 2 };
    doc.layers = [
      { ...doc.layers[0]!, pageIndex: 0 },
      ...Array.from({ length: 4 }, (_, i) => slot(1, i)),
    ];
    const plan = planMultiPageRender(doc, ctx(5));
    expect(plan).toHaveLength(3);
    expect(plan[0]!.pageCtx.images).toEqual([]);
    expect(plan[0]!.pageDoc.layers.every((l) => l.type !== 'imageSlot')).toBe(true);
    expect(plan[1]!.pageCtx.images).toEqual(['img-0', 'img-1', 'img-2', 'img-3']);
    expect(plan[1]!.pageDoc.layers.filter((l) => l.type === 'imageSlot')).toHaveLength(4);
    expect(plan[2]!.pageCtx.images).toEqual(['img-4']);
    expect(plan[2]!.pageDoc.layers.filter((l) => l.type === 'imageSlot')).toHaveLength(4);
  });

  it('uses settings.imagesPerPage when template has no slots', () => {
    const doc: CanvasDocument = {
      ...createEmptyDocument('Legacy'),
      settings: { imagesPerPage: 2 },
      layers: [createEmptyDocument().layers[0]!],
    };
    const plan = planMultiPageRender(doc, ctx(5));
    expect(plan).toHaveLength(3);
  });
});
