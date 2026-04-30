import { describe, expect, it } from 'vitest';
import { REPORT_TYPES, chunkArray, getDefaultHeader, getReportConfig } from '../constants';

describe('reportes-campo report model', () => {
  it('builds one report page per group of four photos', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 4)).toEqual([[1, 2, 3, 4], [5]]);
  });

  it('uses the configured title as the default header title', () => {
    const config = getReportConfig('maquina-balde');

    expect(getDefaultHeader(config).titulo).toBe('Máquina de Balde');
  });

  it('does not depend on HTTP endpoints for desktop export', () => {
    for (const reportType of REPORT_TYPES) {
      expect(reportType).not.toHaveProperty('endpoint');
    }
  });
});
