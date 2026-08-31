import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../types';
import { appendPdfFragment, mapPdfPagesToCanvas } from '../pdfToCanvas';

describe('PDF to Canvas mapping', () => {
  it('maps only supported primitives and reports skipped content', () => {
    const fragment = mapPdfPagesToCanvas({
      pageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      operators: 8,
      primitives: [
        { kind: 'text', box: { x: 72, y: 700, width: 100, height: 20 }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, text: 'Hola', fontSizePt: 12 },
        { kind: 'rect', box: { x: 72, y: 600, width: 100, height: 40 }, fill: '#ffffff' },
        { kind: 'ellipse', box: { x: 200, y: 600, width: 40, height: 40 }, stroke: '#000000' },
        { kind: 'line', box: { x: 72, y: 550, width: 100, height: 0 }, points: [{ x: 72, y: 550 }, { x: 172, y: 550 }], stroke: '#000000' },
        { kind: 'checkbox', box: { x: 72, y: 500, width: 12, height: 12 }, checked: true },
        { kind: 'unsupported', box: { x: 0, y: 0, width: 10, height: 10 }, reason: 'complex-path', sourceOpCount: 2 },
      ],
      warnings: [],
    });

    expect(fragment.layers.filter((layer) => layer.type !== 'frame')).toHaveLength(5);
    expect(fragment.report.skippedCount).toBe(1);
    expect(fragment.layers.some((layer) => layer.type === 'frame' && layer.locked)).toBe(true);
  });

  it('appends imported pages after the existing document pages', () => {
    const document = createEmptyDocument('Base');
    const fragment = mapPdfPagesToCanvas({
      pageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      operators: 0,
      primitives: [],
      warnings: [],
    });
    const next = appendPdfFragment(document, fragment);
    expect(next.pages).toHaveLength(2);
    expect(next.layers.some((layer) => layer.pageIndex === 1)).toBe(true);
    expect(document.pages).toHaveLength(1);
  });
});
