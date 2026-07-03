import { describe, expect, it } from 'vitest';
import {
  filterBdImgRows,
  getBdImgDataRows,
  rowEstadoType,
} from './bdImgTableUtils';

const SAMPLE_ROWS = [
  ['NIS', 'SGIO', 'DESTINO', 'NOMBRE', 'DIR', 'IMG_1', 'IMG_2', 'IMG_3', 'CANT', 'ESTADO', 'ORIGEN'],
  ['4210801', '69656525', 'DVD 03', 'PREDIO A', '', '✅', '✅', '✅', '3', '🟢 COMPLETO', 'JUAN'],
  ['4210802', '', 'DVD 03', 'PREDIO B', '', '✅', '⬜', '⬜', '1', '🔴 FALTANTE', 'PEDRO'],
  ['4210803', '69656527', 'DVD 03', 'PREDIO C', '', '✅', '✅', '✅', '4', '🟡 SOBRANTE', 'JUAN'],
];

describe('bdImgTableUtils', () => {
  it('skips header row in getBdImgDataRows', () => {
    expect(getBdImgDataRows(SAMPLE_ROWS)).toHaveLength(3);
  });

  it('classifies estado types', () => {
    expect(rowEstadoType('🟢 COMPLETO')).toBe('completo');
    expect(rowEstadoType('🔴 FALTANTE')).toBe('faltante');
    expect(rowEstadoType('🟡 SOBRANTE')).toBe('sobrante');
  });

  it('filters by estado', () => {
    const data = getBdImgDataRows(SAMPLE_ROWS);
    expect(filterBdImgRows(data, 'faltante', '').map((r) => r[0])).toEqual(['4210802']);
  });

  it('filters by search across NIS, SGIO, nombre and origen', () => {
    const data = getBdImgDataRows(SAMPLE_ROWS);
    expect(filterBdImgRows(data, 'all', 'pedro').map((r) => r[0])).toEqual(['4210802']);
    expect(filterBdImgRows(data, 'all', '69656525').map((r) => r[0])).toEqual(['4210801']);
  });
});