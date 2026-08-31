import { describe, expect, it } from 'vitest';
import { mapPdfPagesToCanvas } from '../pdfToCanvas';
import type { PdfPageExtraction } from '../pdfImportTypes';

function page(pageNumber: number, widthPt = 612, heightPt = 792): PdfPageExtraction {
  return {
    pageNumber,
    widthPt,
    heightPt,
    operators: 12,
    warnings: [],
    primitives: [
      {
        kind: 'text',
        box: { x: 72, y: 700, width: 120, height: 18 },
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        text: 'Texto editable',
        fontSizePt: 12,
      },
      {
        kind: 'rect',
        box: { x: 72, y: 640, width: 120, height: 32 },
        fill: '#FFFFFF',
        stroke: '#000000',
        strokeWidthPt: 1,
      },
      {
        kind: 'ellipse',
        box: { x: 220, y: 640, width: 32, height: 32 },
        stroke: '#000000',
      },
      {
        kind: 'line',
        box: { x: 72, y: 600, width: 120, height: 0 },
        points: [{ x: 72, y: 600 }, { x: 192, y: 600 }],
        stroke: '#000000',
      },
      {
        kind: 'checkbox',
        box: { x: 72, y: 550, width: 12, height: 12 },
        checked: true,
      },
      {
        kind: 'unsupported',
        box: { x: 0, y: 0, width: 40, height: 40 },
        reason: 'complex-path',
        sourceOpCount: 4,
      },
    ],
  };
}

describe('PDF import corpus contract', () => {
  it('keeps high-confidence primitives editable and reports complex paths', () => {
    const fragment = mapPdfPagesToCanvas(page(1));

    expect(fragment.layers.map((layer) => layer.type)).toEqual([
      'frame', 'text', 'rect', 'ellipse', 'line', 'checkbox',
    ]);
    expect(fragment.report.skippedCount).toBe(1);
    expect(fragment.report.issues[0]).toMatchObject({ reason: 'complex-path', count: 1 });
  });

  it('does not double-count issues already aggregated by extraction', () => {
    const source = page(1);
    source.issues = [{
      pageNumber: 1,
      reason: 'complex-path',
      message: 'Path PDF complejo no editable',
      count: 1,
    }];

    const fragment = mapPdfPagesToCanvas(source);

    expect(fragment.report.issues).toEqual([
      expect.objectContaining({ reason: 'complex-path', count: 1 }),
    ]);
  });

  it('rejects mixed pages by default and scales them only by explicit policy', () => {
    expect(() => mapPdfPagesToCanvas([page(1), page(2, 792, 612)])).toThrow(/tamaños de página/);

    const fragment = mapPdfPagesToCanvas([page(1), page(2, 792, 612)], {
      mixedPagePolicy: 'scale-to-first',
    });
    expect(fragment.pages).toHaveLength(2);
    expect(fragment.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'mixed-page-size' })]),
    );
  });

  it('keeps repeated imports collision-free and enforces the layer budget', () => {
    const first = mapPdfPagesToCanvas(page(1), { limits: { maxLayersTotal: 2 } });
    const second = mapPdfPagesToCanvas(page(1), { limits: { maxLayersTotal: 2 } });
    const firstIds = new Set(first.importedLayerIds);
    expect(first.importedLayerIds).toHaveLength(2);
    expect(second.importedLayerIds.every((id) => !firstIds.has(id))).toBe(true);
    expect(first.report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'limit-exceeded' })]),
    );
  });
});
