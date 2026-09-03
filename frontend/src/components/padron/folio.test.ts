import { describe, expect, it } from 'vitest';
import {
  createDefaultFolioConfig,
  expectedFolioEnd,
  formatPageNumberLabel,
  getPageFolio,
  getPageNumberAppearanceStyle,
  resolvePageNumberStyle,
  resolvePhysicalFolios,
  syncFolioEndWithPageCount,
} from './folio';

function hasDuplicateFolios(folios: number[]): boolean {
  return new Set(folios).size !== folios.length;
}

describe('resolvePhysicalFolios', () => {
  it('assigns sequential folios 1 to 50 by default', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 1,
      folioEnd: 50,
      folioInverted: false,
    });
    expect(folios[0]).toBe(1);
    expect(folios[49]).toBe(50);
    expect(folios).toHaveLength(50);
    expect(hasDuplicateFolios(folios)).toBe(false);
  });

  it('reverses folios when inverted', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 1,
      folioEnd: 50,
      folioInverted: true,
    });
    expect(folios[0]).toBe(50);
    expect(folios[49]).toBe(1);
    expect(hasDuplicateFolios(folios)).toBe(false);
  });

  it('supports offset start at 2 ascending to 51', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 2,
      folioEnd: 51,
      folioInverted: false,
    });
    expect(folios[0]).toBe(2);
    expect(folios[49]).toBe(51);
    expect(hasDuplicateFolios(folios)).toBe(false);
  });

  it('supports inverted offset (51 down to 2)', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 2,
      folioEnd: 51,
      folioInverted: true,
    });
    expect(folios[0]).toBe(51);
    expect(folios[49]).toBe(2);
    expect(hasDuplicateFolios(folios)).toBe(false);
  });

  it('returns a single folio for one page', () => {
    expect(
      resolvePhysicalFolios(1, {
        folioStart: 5,
        folioEnd: 10,
        folioInverted: true,
      }),
    ).toEqual([10]);
  });

  it('returns empty array for zero pages', () => {
    expect(
      resolvePhysicalFolios(0, {
        folioStart: 1,
        folioEnd: 50,
        folioInverted: false,
      }),
    ).toEqual([]);
  });

  it('never duplicates folios when start is offset and end was page-count synced', () => {
    const folios = resolvePhysicalFolios(3, {
      folioStart: 2,
      folioEnd: 3,
      folioInverted: false,
    });
    expect(folios).toEqual([2, 3, 4]);
    expect(hasDuplicateFolios(folios)).toBe(false);
  });

  it('never duplicates folios across common page counts with offset starts', () => {
    for (const pages of [2, 3, 10, 18, 50, 100]) {
      for (const start of [1, 2, 5, 10]) {
        const end = expectedFolioEnd(start, pages);
        const ascending = resolvePhysicalFolios(pages, {
          folioStart: start,
          folioEnd: end,
          folioInverted: false,
        });
        const inverted = resolvePhysicalFolios(pages, {
          folioStart: start,
          folioEnd: end,
          folioInverted: true,
        });
        expect(hasDuplicateFolios(ascending)).toBe(false);
        expect(hasDuplicateFolios(inverted)).toBe(false);
        expect(ascending).toHaveLength(pages);
        expect(inverted).toHaveLength(pages);
      }
    }
  });
});

describe('getPageFolio', () => {
  it('returns mapped folio for valid index', () => {
    expect(getPageFolio(0, [50, 49, 48])).toBe(50);
  });

  it('falls back to index + 1 for out-of-range index', () => {
    expect(getPageFolio(5, [1, 2, 3])).toBe(6);
  });
});

describe('syncFolioEndWithPageCount', () => {
  it('auto-updates folioEnd when it was synced to previous page count', () => {
    const prev = {
      ...createDefaultFolioConfig(),
      folioStart: 1,
      folioEnd: 2,
      syncedPageCount: 2,
    };
    const next = syncFolioEndWithPageCount(prev, 3);
    expect(next.folioEnd).toBe(3);
    expect(next.syncedPageCount).toBe(3);
  });

  it('auto-updates folioEnd relative to folioStart when pages change', () => {
    const prev = {
      ...createDefaultFolioConfig(),
      folioStart: 5,
      folioEnd: 6,
      syncedPageCount: 2,
    };
    const next = syncFolioEndWithPageCount(prev, 4);
    expect(next.folioEnd).toBe(8);
    expect(next.syncedPageCount).toBe(4);
  });

  it('preserves custom folioEnd when user changed it outside the auto window', () => {
    const prev = {
      ...createDefaultFolioConfig(),
      folioStart: 1,
      folioEnd: 99,
      syncedPageCount: 2,
    };
    const next = syncFolioEndWithPageCount(prev, 3);
    expect(next.folioEnd).toBe(99);
  });

  it('syncs null folioEnd to expected end for total pages', () => {
    const prev = createDefaultFolioConfig();
    const next = syncFolioEndWithPageCount(prev, 18);
    expect(next.folioEnd).toBe(18);
    expect(next.syncedPageCount).toBe(18);
  });
});

describe('expectedFolioEnd', () => {
  it('returns start + pages - 1', () => {
    expect(expectedFolioEnd(1, 50)).toBe(50);
    expect(expectedFolioEnd(2, 50)).toBe(51);
    expect(expectedFolioEnd(5, 1)).toBe(5);
  });
});

describe('formatPageNumberLabel', () => {
  it('formats Página N de X', () => {
    expect(formatPageNumberLabel('pagina_de', 2, 5)).toBe('Página 2 de 5');
  });

  it('formats N de X', () => {
    expect(formatPageNumberLabel('n_de', 2, 5)).toBe('2 de 5');
  });

  it('formats solo número', () => {
    expect(formatPageNumberLabel('solo', 2, 5)).toBe('2');
  });

  it('auto keeps plantilla defaults', () => {
    expect(formatPageNumberLabel('auto', 1, 3, 'service-interruption')).toBe('Página 1 de 3');
    expect(formatPageNumberLabel('auto', 1, 3, 'volante-lurigancho')).toBe('1 de 3');
    expect(formatPageNumberLabel('auto', 1, 3, 'volanteo-lurigancho-v2')).toBe('1');
    expect(formatPageNumberLabel('auto', 1, 3, 'water-cut-notice')).toBe('Página 1 de 3');
  });

  it('explicit style overrides plantilla default', () => {
    expect(formatPageNumberLabel('pagina_de', 1, 3, 'volante-lurigancho')).toBe('Página 1 de 3');
    expect(formatPageNumberLabel('solo', 4, 10, 'service-interruption')).toBe('4');
  });
});

describe('resolvePageNumberStyle', () => {
  it('passes through explicit styles', () => {
    expect(resolvePageNumberStyle('solo')).toBe('solo');
    expect(resolvePageNumberStyle('n_de')).toBe('n_de');
    expect(resolvePageNumberStyle('pagina_de')).toBe('pagina_de');
  });
});

describe('getPageNumberAppearanceStyle', () => {
  it('returns empty object when size and font stay auto', () => {
    expect(getPageNumberAppearanceStyle('auto', 'auto')).toEqual({});
  });

  it('maps size overrides to pixel font sizes', () => {
    expect(getPageNumberAppearanceStyle('sm', 'auto')).toEqual({ fontSize: '8px' });
    expect(getPageNumberAppearanceStyle('md', 'auto')).toEqual({ fontSize: '10px' });
    expect(getPageNumberAppearanceStyle('lg', 'auto')).toEqual({ fontSize: '14px' });
    expect(getPageNumberAppearanceStyle('xl', 'auto')).toEqual({ fontSize: '18px' });
  });

  it('maps font style overrides to weight and italic', () => {
    expect(getPageNumberAppearanceStyle('auto', 'normal')).toEqual({
      fontWeight: 400,
      fontStyle: 'normal',
    });
    expect(getPageNumberAppearanceStyle('auto', 'bold')).toEqual({
      fontWeight: 700,
      fontStyle: 'normal',
    });
    expect(getPageNumberAppearanceStyle('auto', 'italic')).toEqual({
      fontWeight: 400,
      fontStyle: 'italic',
    });
    expect(getPageNumberAppearanceStyle('lg', 'bold_italic')).toEqual({
      fontSize: '14px',
      fontWeight: 700,
      fontStyle: 'italic',
    });
  });
});
