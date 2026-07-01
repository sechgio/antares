import { describe, it, expect } from 'vitest';
import {
  createDefaultRange,
  migrateLegacyCuadrante,
  resolveCuadranteForPage,
} from './cuadranteRanges';

describe('cuadranteRanges', () => {
  it('resolves cuadrante by page range', () => {
    const ranges = [
      createDefaultRange(1, 2, 'ZONA A'),
      { ...createDefaultRange(3, 4, 'ZONA B'), id: 'b' },
    ];
    expect(resolveCuadranteForPage(1, ranges)).toBe('ZONA A');
    expect(resolveCuadranteForPage(3, ranges)).toBe('ZONA B');
    expect(resolveCuadranteForPage(99, ranges)).toBe('');
  });

  it('migrates legacy single cuadrante field', () => {
    const ranges = migrateLegacyCuadrante('CHORRILLOS', undefined);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].cuadrante).toBe('CHORRILLOS');
    expect(ranges[0].fromPage).toBe(1);
  });
});