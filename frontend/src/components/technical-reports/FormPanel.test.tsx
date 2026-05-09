import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FormPanel from './FormPanel';
import type { TechnicalReport } from './types';

const emptyDiameters = (diameters: string[]) => Object.fromEntries(diameters.map((diameter) => [diameter, 0]));

const report: TechnicalReport = {
  id: 'RPT-0001',
  metadata: { informe_id: 1, dia: 5, mes: 'MAYO', anio: 2026, pagina: '1 de 2' },
  header: {
    cs: 'SUR',
    contratista: 'ACCIONA',
    codigo_infraestructura: 'RES-01',
    ubicacion: 'LIMA',
    suministro: '123',
    tipo: 'ELEVADO',
    volumen: 100,
  },
  inspeccion: {
    caja_registro: 'unchecked',
    marco_tapa: 'unchecked',
    escalera_interior: 'unchecked',
    escalera_exterior: 'unchecked',
    cuba_interior: 'unchecked',
    cuba_exterior: 'unchecked',
    loza_fondo: 'unchecked',
    loza_techo_interior: 'unchecked',
    loza_techo_exterior: 'unchecked',
    ducto_ventilacion: 'unchecked',
    cerco_perimetrico: 'unchecked',
    descarga: 'unchecked',
  },
  valvulas: {
    diametros: emptyDiameters(['2', '3', '4', '6', '8', '10', '12']),
    impulsion: emptyDiameters(['2', '3', '4', '6', '8', '10', '12']),
    aduccion: emptyDiameters(['2', '3', '4', '6', '8', '10', '12']),
    bypass: emptyDiameters(['2', '3', '4', '6', '8', '10', '12']),
    desague: emptyDiameters(['2', '3', '4', '6', '8', '10', '12']),
    operativas: 0,
    no_operativas: 0,
    observaciones_conduccion: '',
    sugerencias_conduccion: '',
    observaciones_impulsion: '',
    sugerencias_impulsion: '',
    observaciones_aduccion: '',
    sugerencias_aduccion: '',
    observaciones_bypass: '',
    sugerencias_bypass: '',
    observaciones_desague: '',
    sugerencias_desague: '',
  },
  canastillas: {
    diametros: emptyDiameters(['2', '3', '4', '6', '8', '10', '14']),
    aduccion: emptyDiameters(['2', '3', '4', '6', '8', '10', '14']),
    succion: emptyDiameters(['2', '3', '4', '6', '8', '10', '14']),
    desague: emptyDiameters(['2', '3', '4', '6', '8', '10', '14']),
    operativas: 0,
    no_operativas: 0,
    observaciones_aduccion: '',
    sugerencias_aduccion: '',
    observaciones_succion: '',
    sugerencias_succion: '',
    observaciones_desague: '',
    sugerencias_desague: '',
  },
  medidas: { diametro: '', diametro_interno: '', altura_util: '', altura_total: '' },
  observaciones: '',
  sugerencias: '',
  status: 'draft',
  last_modified: '2026-05-05T00:00:00',
};

describe('FormPanel', () => {
  it('renders the delete control as a stable icon button', () => {
    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft={null}
        logoRight={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /eliminar informe/i })).toHaveClass('tr-icon-button');
  });
});
