import type { CuadranteRange } from '../types';

export function createRangeId(): string {
  return `range-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultRange(fromPage = 1, toPage = 1, cuadrante = ''): CuadranteRange {
  return { id: createRangeId(), fromPage, toPage, cuadrante };
}

export function resolveCuadranteForPage(pageNum: number, ranges: CuadranteRange[]): string {
  for (const range of ranges) {
    if (pageNum >= range.fromPage && pageNum <= range.toPage) {
      return range.cuadrante;
    }
  }
  return '';
}

export function clampRangeToPages(range: CuadranteRange, totalPages: number): CuadranteRange {
  const maxPage = Math.max(1, totalPages);
  const fromPage = Math.min(Math.max(1, range.fromPage), maxPage);
  const toPage = Math.min(Math.max(fromPage, range.toPage), maxPage);
  return { ...range, fromPage, toPage };
}

export function clampAllRanges(ranges: CuadranteRange[], totalPages: number): CuadranteRange[] {
  return ranges.map((r) => clampRangeToPages(r, totalPages));
}

export function migrateLegacyCuadrante(
  cuadrante: string | undefined,
  cuadranteRanges: CuadranteRange[] | undefined,
): CuadranteRange[] {
  if (cuadranteRanges && cuadranteRanges.length > 0) {
    return cuadranteRanges;
  }
  if (cuadrante?.trim()) {
    return [createDefaultRange(1, 1, cuadrante)];
  }
  return [createDefaultRange()];
}