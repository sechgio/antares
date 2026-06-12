import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import {
  formatRunStats,
  getRunType,
  getTypeFilters,
  RUN_TYPES,
  UNKNOWN_RUN_TYPE,
  type HistoryRunRow,
} from './runTypes';

const BACKEND_RUN_TYPES = [
  'conversion',
  'formato',
  'sellador',
  'padron',
  'volante',
  'image_optimizer',
  'reporte_campo',
  'panel_aviso_corte',
  'informe_tecnico',
];

function makeRun(runType: string, overrides: Partial<HistoryRunRow> = {}): HistoryRunRow {
  return {
    id: 1,
    run_type: runType,
    timestamp: '2026-01-01T00:00:00',
    formato: 'JPEG',
    calidad: 90,
    ok_count: 2,
    err_count: 1,
    patron: '{codigo}',
    files_json: JSON.stringify(['a.jpg', 'b.jpg']),
    options_json: JSON.stringify({ desde: 1, hasta: 5, stamp_count: 3 }),
    ...overrides,
  };
}

describe('runTypes registry', () => {
  it('includes every backend run type', () => {
    for (const id of BACKEND_RUN_TYPES) {
      expect(RUN_TYPES[id as keyof typeof RUN_TYPES], id).toBeDefined();
    }
  });

  it('returns UNKNOWN meta for invented types', () => {
    expect(getRunType('inventado')).toBe(UNKNOWN_RUN_TYPE);
  });

  it('resolves stats for each registered type', () => {
    const t = i18n.getFixedT('es');
    for (const id of BACKEND_RUN_TYPES) {
      const stats = formatRunStats(makeRun(id), t);
      expect(stats.length, id).toBeGreaterThan(0);
      expect(stats.every((stat) => stat.label && stat.value !== undefined), id).toBe(true);
    }
  });

  it('builds type filters from the registry', () => {
    const t = i18n.getFixedT('es');
    const filters = getTypeFilters(t);
    expect(filters[0].value).toBe('all');
    expect(filters.some((f) => f.value === 'sellador')).toBe(true);
    expect(filters.some((f) => f.value === 'informe_tecnico')).toBe(true);
  });
});
