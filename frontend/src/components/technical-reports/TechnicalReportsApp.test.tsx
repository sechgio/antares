import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  confirm: vi.fn(),
  api: {
    technicalReportsList: vi.fn(),
    technicalReportsGet: vi.fn(),
    technicalReportsCreate: vi.fn(),
    technicalReportsUpdate: vi.fn(),
    technicalReportsDelete: vi.fn(),
    technicalReportsClear: vi.fn(),
    technicalReportsImportFile: vi.fn(),
    technicalReportsRenderHtml: vi.fn(),
    technicalReportsRenderConsolidatedHtml: vi.fn(),
    htmlToPdf: vi.fn(),
  },
}));

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../api', () => ({ api: mocks.api }));

import TechnicalReportsApp from './TechnicalReportsApp';
import type { TechnicalReport, TechnicalReportListItem } from './types';

const emptyDiameters = (diameters: string[]) => Object.fromEntries(diameters.map((diameter) => [diameter, 0]));

const report: TechnicalReport = {
  id: 'RPT-0001',
  metadata: { informe_id: 1, dia: 5, mes: 'MAYO', anio: 2026, pagina: '1 de 2' },
  header: {
    cs: 'SUR',
    contratista: 'ACCIONA',
    sgio: '454654001',
    sgio_label: 'SGIO',
    titulo_linea1: 'Limpieza y Desinfección de Reservorios y Cisternas',
    titulo_linea2: 'Centro de Servicio Villa El Salvador',
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
  medidas: {
    diametro: '',
    diametro_interno: '',
    altura_util: '',
    altura_total: '',
    etiqueta_diametro: 'DIAMETRO',
    etiqueta_diametro_interno: 'DIAMETRO INTERNO',
  },
  observaciones: '',
  sugerencias: '',
  status: 'draft',
  last_modified: '2026-05-05T00:00:00',
};

const listItem: TechnicalReportListItem = {
  id: 'RPT-0001',
  metadata: { informe_id: 1 },
  header: { cs: 'SUR', codigo_infraestructura: 'RES-01' },
  status: 'draft',
};

describe('TechnicalReportsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.api.technicalReportsList.mockResolvedValue({ reports: [listItem] });
    mocks.api.technicalReportsGet.mockResolvedValue({ report });
    mocks.api.technicalReportsUpdate.mockResolvedValue({ success: true, report });
    mocks.api.technicalReportsDelete.mockResolvedValue({ deleted: true });
    mocks.api.technicalReportsClear.mockResolvedValue({});
    mocks.api.technicalReportsImportFile.mockResolvedValue({ imported_count: 2 });
  });

  it('lists reports on mount and opens one on click', async () => {
    render(<TechnicalReportsApp />);

    expect(await screen.findByText('SUR', { selector: '.tr-list-main' })).toBeInTheDocument();
    expect(mocks.api.technicalReportsList).toHaveBeenCalledWith({ summary: true });

    await act(async () => {
      fireEvent.click(screen.getByText('SUR', { selector: '.tr-list-main' }));
    });

    expect(mocks.api.technicalReportsGet).toHaveBeenCalledWith('RPT-0001');
    expect(screen.getByText(/Informe #1/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('ACCIONA')).toBeInTheDocument();
  });

  it('saves edits through technicalReportsUpdate', async () => {
    render(<TechnicalReportsApp />);
    fireEvent.click(await screen.findByText('SUR', { selector: '.tr-list-main' }));
    await act(async () => Promise.resolve());

    const csInput = screen.getByDisplayValue('SUR');
    fireEvent.change(csInput, { target: { value: 'NORTE' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(mocks.api.technicalReportsUpdate).toHaveBeenCalledWith(
      'RPT-0001',
      expect.objectContaining({ header: expect.objectContaining({ cs: 'NORTE' }) }),
    );
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe guardado', type: 'success' });
  });

  it('deletes the selected report after confirm', async () => {
    render(<TechnicalReportsApp />);
    fireEvent.click(await screen.findByText('SUR', { selector: '.tr-list-main' }));
    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar informe' }));
    });

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
    expect(mocks.api.technicalReportsDelete).toHaveBeenCalledWith('RPT-0001');
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe eliminado', type: 'success' });
  });

  it('imports a file through the hidden input', async () => {
    const { container } = render(<TechnicalReportsApp />);
    await screen.findByText('SUR', { selector: '.tr-list-main' });

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, { target: { files: [new File(['a,b'], 'informes.csv', { type: 'text/csv' })] } });
    });

    await waitFor(() => expect(mocks.api.technicalReportsImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'informes.csv' }),
    ));
    expect(mocks.addToast).toHaveBeenCalledWith({ message: '2 informes importados', type: 'success' });
  });

  it('surfaces a failed list load as an error toast', async () => {
    mocks.api.technicalReportsList.mockRejectedValue(new Error('backend caído'));
    render(<TechnicalReportsApp />);

    await act(async () => Promise.resolve());

    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'backend caído', type: 'error' });
    expect(screen.getByText('No hay informes para mostrar')).toBeInTheDocument();
  });
});
