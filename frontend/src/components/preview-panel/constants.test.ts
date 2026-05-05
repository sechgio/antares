import { describe, expect, it } from 'vitest';
import { REPORT_FIELDS } from './constants';

describe('preview panel report fields', () => {
  it('does not expose retired fields in the default mapping list', () => {
    const labels = REPORT_FIELDS.map(field => field.label);

    expect(labels).toContain('Centro');
    expect(labels).toContain('Nro OT');
    expect(labels).not.toContain('Cuadrilla');
    expect(labels).not.toContain('Obs. SEDAPAL');
    expect(labels).not.toContain('Obs. Contrata');
    expect(labels).not.toContain('Fecha Corte');
    expect(labels).not.toContain('Fecha Trabajo');
    expect(labels).not.toContain('Dir. Afectadas');
  });
});
