import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sessionSearch = require('../../electron/session-search');

const NOW = Date.UTC(2026, 10, 25);
const DAY = 86400000;

describe('sessions_search con FTS5', () => {
  it('encuentra con acentos, plurales, prefijos y resalta la coincidencia', () => {
    const docs = [
      { text: 'La facturación electrónica quedó lista', ts: NOW },
      { text: 'Enviamos el reporte mensual a gerencia', ts: NOW },
      { text: 'Nada que ver con esto', ts: NOW },
    ];
    expect(sessionSearch.rank('FACTURACION', docs, NOW).map((hit) => hit.index)).toEqual([0]);
    expect(sessionSearch.rank('facturas', docs, NOW).map((hit) => hit.index)).toEqual([0]);
    expect(sessionSearch.rank('reportes', docs, NOW).map((hit) => hit.index)).toEqual([1]);
    expect(sessionSearch.rank('electr', docs, NOW).map((hit) => hit.index)).toEqual([0]);
    expect(sessionSearch.rank('facturación', docs, NOW)[0].snippet).toContain('**facturación**');
  });

  it('prioriza la frase completa, la cobertura y la recencia', () => {
    const docs = [
      { text: 'El informe salió y el cierre mensual también', ts: NOW },
      { text: 'Revisa el informe mensual de cortes', ts: NOW - 400 * DAY },
      { text: 'Revisa el informe mensual de cortes', ts: NOW },
      { text: 'Solo informe', ts: NOW },
    ];
    expect(sessionSearch.rank('informe mensual', docs, NOW).map((hit) => hit.index)).toEqual([2, 0, 1, 3]);
  });

  it('devuelve null cuando solo hay palabras vacías para usar la búsqueda por palabras', () => {
    expect(sessionSearch.rank('para con', [{ text: 'para con', ts: NOW }], NOW)).toBeNull();
    expect(sessionSearch.terms('Los reportes de facturas')).toEqual(['factura', 'report']);
  });
});
