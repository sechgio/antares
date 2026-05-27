import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewPanel from './PreviewPanel';
import type { TechnicalReport } from './types';

const diameters = (items: string[]) => Object.fromEntries(items.map((diameter) => [diameter, 0]));

const report: TechnicalReport = {
  id: 'RPT-0001',
  metadata: { informe_id: 1, dia: 5, mes: 'MAYO', anio: 2026, pagina: '1 de 2' },
  header: {
    cs: 'SUR',
    contratista: 'ACCIONA',
    sgio: '454654001',
    codigo_infraestructura: 'RES-01',
    ubicacion: 'LIMA',
    suministro: '123',
    tipo: 'ELEVADO',
    volumen: 100,
  },
  inspeccion: {
    caja_registro: 'normal',
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
    descarga: 'critico',
  },
  valvulas: {
    diametros: diameters(['2', '3', '4', '6', '8', '10', '12']),
    impulsion: diameters(['2', '3', '4', '6', '8', '10', '12']),
    aduccion: diameters(['2', '3', '4', '6', '8', '10', '12']),
    bypass: diameters(['2', '3', '4', '6', '8', '10', '12']),
    desague: diameters(['2', '3', '4', '6', '8', '10', '12']),
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
    diametros: diameters(['2', '3', '4', '6', '8', '10', '14']),
    aduccion: diameters(['2', '3', '4', '6', '8', '10', '14']),
    succion: diameters(['2', '3', '4', '6', '8', '10', '14']),
    desague: diameters(['2', '3', '4', '6', '8', '10', '14']),
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

describe('PreviewPanel', () => {
  it('shows critical checks in red like the exported PDF', () => {
    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} />);

    expect(screen.getByTestId('preview-check-descarga-critico')).toHaveClass('tr-check-critico');
  });

  it('shows SGIO alongside contratista in the header table', () => {
    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} />);

    expect(screen.getByText('454654001')).toBeInTheDocument();
    expect(screen.getByText('ACCIONA')).toBeInTheDocument();
  });
});
