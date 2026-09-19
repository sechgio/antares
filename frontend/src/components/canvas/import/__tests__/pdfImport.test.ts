import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../types';
import { pdfBoxToCanvasBox, pdfPointsToMm } from '../pdfGeometry';
import {
  DEFAULT_PDF_IMPORT_LIMITS,
  assertPdfFileSize,
  normalizePdfPageRange,
  resolvePdfImportLimits,
} from '../pdfImportLimits';
import { appendPdfFragment, mapPdfPagesToCanvas } from '../pdfToCanvas';

describe('PDF geometry', () => {
  it('converts points to millimeters', () => {
    expect(pdfPointsToMm(72)).toBeCloseTo(25.4, 6);
  });

  it('flips the PDF Y axis into Canvas top-left coordinates', () => {
    const box = pdfBoxToCanvasBox(
      { x: 72, y: 72, width: 144, height: 72 },
      { widthPt: 612, heightPt: 792 },
    );
    expect(box.xMm).toBeCloseTo(25.4, 6);
    expect(box.yMm).toBeCloseTo(pdfPointsToMm(648), 6);
    expect(box.widthMm).toBeCloseTo(50.8, 6);
    expect(box.heightMm).toBeCloseTo(25.4, 6);
  });
});

describe('PDF import limits', () => {
  it('rejects a file above the configured byte budget', () => {
    expect(() =>
      assertPdfFileSize(DEFAULT_PDF_IMPORT_LIMITS.maxFileBytes + 1, DEFAULT_PDF_IMPORT_LIMITS),
    ).toThrow('100 MiB');
  });

  it('merges only positive finite integer overrides', () => {
    const limits = resolvePdfImportLimits({
      maxPages: 12,
      maxLayersPerPage: 80,
      maxOperatorsPerPage: 0,
      maxImageBytesTotal: Number.NaN,
    });

    expect(limits.maxPages).toBe(12);
    expect(limits.maxLayersPerPage).toBe(80);
    expect(limits.maxOperatorsPerPage).toBe(
      DEFAULT_PDF_IMPORT_LIMITS.maxOperatorsPerPage,
    );
    expect(limits.maxImageBytesTotal).toBe(
      DEFAULT_PDF_IMPORT_LIMITS.maxImageBytesTotal,
    );
  });

  it('normalizes and validates requested page ranges', () => {
    expect(normalizePdfPageRange(5, 2, 99)).toEqual({ first: 2, last: 5 });
    expect(() => normalizePdfPageRange(5, 6, 6)).toThrow('Rango de páginas inválido');
    expect(() => normalizePdfPageRange(5, 3, 2)).toThrow('Rango de páginas inválido');
  });
});

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
