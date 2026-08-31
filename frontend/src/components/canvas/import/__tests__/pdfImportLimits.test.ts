import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PDF_IMPORT_LIMITS,
  assertPdfFileSize,
  normalizePdfPageRange,
  resolvePdfImportLimits,
} from '../pdfImportLimits';

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
