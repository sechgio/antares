import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { appendPdfFragment, mapPdfPagesToCanvas } from '../import/pdfToCanvas';
import { indexLayersByPage } from '../ops/pages';
import { createEmptyDocument } from '../types';

describe('PDF import page performance', () => {
  it('indexes layers by page without duplicating layer objects', () => {
    const page0 = createLayer('rect', { id: 'page-0', pageIndex: 0 });
    const page1 = createLayer('rect', { id: 'page-1', pageIndex: 1 });
    const index = indexLayersByPage([page0, page1]);

    expect(index.get(0)).toEqual([page0]);
    expect(index.get(1)).toEqual([page1]);
    expect(index.get(2) ?? []).toEqual([]);
  });

  it('maps and appends a bounded multi-page fragment without mutating the source document', () => {
    const source = createEmptyDocument('PDF import');
    const pages = Array.from({ length: 5 }, (_, pageIndex) => ({
      pageIndex,
      pageNumber: pageIndex + 1,
      widthPt: 595.28,
      heightPt: 841.89,
      warnings: [],
      primitives: Array.from({ length: 20 }, (_, itemIndex) => ({
        kind: 'rect' as const,
        box: { x: itemIndex, y: pageIndex, width: 5, height: 4 },
        fill: '#ffffff',
        stroke: '#000000',
      })),
    }));
    const mapped = mapPdfPagesToCanvas(pages);
    const sourceLayers = source.layers;
    const imported = appendPdfFragment(source, mapped);

    expect(mapped.report.importedCount).toBe(100);
    expect(imported).not.toBe(source);
    expect(source.layers).toBe(sourceLayers);
    expect(source.layers).toHaveLength(1);
    expect(imported.layers).toHaveLength(106);
    expect(imported.pages).toHaveLength(6);
  });
});
