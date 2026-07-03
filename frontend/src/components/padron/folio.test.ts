import { describe, expect, it } from 'vitest';
import {
  createDefaultFolioConfig,
  getPageFolio,
  resolvePhysicalFolios,
  syncFolioEndWithPageCount,
} from './folio';

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
  });

  it('reverses folios when inverted', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 1,
      folioEnd: 50,
      folioInverted: true,
    });
    expect(folios[0]).toBe(50);
    expect(folios[49]).toBe(1);
  });

  it('supports offset start at 2 ascending to 51', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 2,
      folioEnd: 51,
      folioInverted: false,
    });
    expect(folios[0]).toBe(2);
    expect(folios[49]).toBe(51);
  });

  it('supports inverted offset (51 down to 2)', () => {
    const folios = resolvePhysicalFolios(50, {
      folioStart: 2,
      folioEnd: 51,
      folioInverted: true,
    });
    expect(folios[0]).toBe(51);
    expect(folios[49]).toBe(2);
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
      folioEnd: 2,
      syncedPageCount: 2,
    };
    const next = syncFolioEndWithPageCount(prev, 3);
    expect(next.folioEnd).toBe(3);
    expect(next.syncedPageCount).toBe(3);
  });

  it('preserves custom folioEnd when user changed it', () => {
    const prev = {
      ...createDefaultFolioConfig(),
      folioEnd: 99,
      syncedPageCount: 2,
    };
    const next = syncFolioEndWithPageCount(prev, 3);
    expect(next.folioEnd).toBe(99);
  });

  it('syncs null folioEnd to total pages', () => {
    const prev = createDefaultFolioConfig();
    const next = syncFolioEndWithPageCount(prev, 18);
    expect(next.folioEnd).toBe(18);
    expect(next.syncedPageCount).toBe(18);
  });
});
