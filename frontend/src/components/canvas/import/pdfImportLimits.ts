export interface PdfImportLimits {
  maxFileBytes: number;
  maxPages: number;
  maxOperatorsPerPage: number;
  maxTextItemsPerPage: number;
  maxImagesPerPage: number;
  maxLayersPerPage: number;
  maxLayersTotal: number;
  maxImageBytesTotal: number;
  maxManifestBytes: number;
}

export const DEFAULT_PDF_IMPORT_LIMITS: Readonly<PdfImportLimits> = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  maxPages: 50,
  maxOperatorsPerPage: 200_000,
  maxTextItemsPerPage: 2_000,
  maxImagesPerPage: 100,
  maxLayersPerPage: 400,
  maxLayersTotal: 1_000,
  maxImageBytesTotal: 64 * 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
});

const INTEGER_KEYS: Array<keyof PdfImportLimits> = [
  'maxFileBytes',
  'maxPages',
  'maxOperatorsPerPage',
  'maxTextItemsPerPage',
  'maxImagesPerPage',
  'maxLayersPerPage',
  'maxLayersTotal',
  'maxImageBytesTotal',
  'maxManifestBytes',
];

export function resolvePdfImportLimits(
  overrides: Partial<PdfImportLimits> = {},
): PdfImportLimits {
  const next = { ...DEFAULT_PDF_IMPORT_LIMITS };
  for (const key of INTEGER_KEYS) {
    const value = overrides[key];
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      Number.isInteger(value)
    ) {
      next[key] = value;
    }
  }
  return next;
}

export function assertPdfFileSize(size: number, limits: PdfImportLimits): void {
  if (!Number.isFinite(size) || size < 0 || size > limits.maxFileBytes) {
    throw new Error(
      'El PDF excede el límite de ' +
        Math.round(limits.maxFileBytes / 1024 / 1024) +
        ' MiB',
    );
  }
}

export function normalizePdfPageRange(
  pageCount: number,
  pageStart?: number,
  pageEnd?: number,
): { first: number; last: number } {
  const first = typeof pageStart === 'number' && Number.isFinite(pageStart)
    ? Math.floor(pageStart)
    : 1;
  const requestedLast = typeof pageEnd === 'number' && Number.isFinite(pageEnd)
    ? Math.floor(pageEnd)
    : pageCount;
  if (pageCount < 1 || first < 1 || first > pageCount || requestedLast < first) {
    throw new Error('Rango de páginas inválido');
  }
  return { first, last: Math.min(pageCount, requestedLast) };
}
