import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  confirm: vi.fn(),
  saveFeatureHistory: vi.fn(),
  api: {
    dialogSave: vi.fn(),
    informesV2List: vi.fn(),
    informesV2Get: vi.fn(),
    informesV2Create: vi.fn(),
    informesV2Update: vi.fn(),
    informesV2Delete: vi.fn(),
    informesV2Clear: vi.fn(),
    informesV2ImportFile: vi.fn(),
    informesV2DownloadTemplate: vi.fn(),
    informesV2RenderHtml: vi.fn(),
    informesV2RenderConsolidatedHtml: vi.fn(),
    htmlToPdf: vi.fn(),
  },
}));

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../api', () => ({ api: mocks.api }));
vi.mock('../../utils/history', () => ({ saveFeatureHistory: mocks.saveFeatureHistory }));

import InformesV2App from './InformesV2App';
import { createEmptyInforme } from './types';
import type { InformeV2ListItem } from './types';

const report = { ...createEmptyInforme(1), header: { ...createEmptyInforme(1).header, estacion: 'ESTACION 1' } };

const listItem: InformeV2ListItem = {
  id: 'IV2-0001',
  metadata: { informe_id: 1 },
  header: { photo_id: 'F-01', estacion: 'ESTACION 1', suministro: '123', distrito: 'VES' },
  status: 'draft',
};

describe('InformesV2App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.api.informesV2List.mockResolvedValue({ items: [listItem] });
    mocks.api.informesV2Get.mockResolvedValue({ item: report });
    mocks.api.informesV2Update.mockResolvedValue({ success: true, item: report });
    mocks.api.informesV2Delete.mockResolvedValue({ deleted_id: 'R-1' });
    mocks.api.informesV2Clear.mockResolvedValue({});
    mocks.api.informesV2ImportFile.mockResolvedValue({ imported_count: 2 });
    mocks.api.informesV2DownloadTemplate.mockResolvedValue({
      filename: 'informes_v2_plantilla_nueva.xlsx',
      content_b64: '',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    mocks.api.dialogSave.mockResolvedValue({ paths: ['C:\\salida.pdf'] });
    mocks.api.informesV2RenderConsolidatedHtml.mockResolvedValue({ html: '<html></html>', filename: 'salida.pdf', count: 1 });
    mocks.api.htmlToPdf.mockResolvedValue({ filename: 'salida.pdf', saved_path: 'C:\\salida.pdf' });
    mocks.saveFeatureHistory.mockResolvedValue(undefined);
  });

  it('lists reports on mount and opens one on click', async () => {
    render(<InformesV2App />);

    expect(await screen.findByText('ESTACION 1')).toBeInTheDocument();
    expect(mocks.api.informesV2List).toHaveBeenCalledWith({ summary: true });

    await act(async () => {
      fireEvent.click(screen.getByText('ESTACION 1'));
    });

    expect(mocks.api.informesV2Get).toHaveBeenCalledWith('IV2-0001');
    expect(screen.getByText(/Informe #1/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('ESTACION 1')).toBeInTheDocument();
  });

  it('abre un informe guardado antes de existir la plantilla Reservorios 2', async () => {
    // JSON.stringify descarta las claves undefined: así llega un informe previo a la plantilla
    const legacy = JSON.parse(
      JSON.stringify({
        ...report,
        plantilla: undefined,
        reservorios2: undefined,
        header: { ...report.header, contratista: undefined, cod_infraestructura: undefined },
      }),
    ) as typeof report;
    mocks.api.informesV2Get.mockResolvedValue({ item: legacy });
    mocks.api.informesV2Update.mockResolvedValue({ success: true, item: legacy });

    render(<InformesV2App />);
    fireEvent.click(await screen.findByText('ESTACION 1'));
    await act(async () => Promise.resolve());

    expect(screen.getByRole('group', { name: 'Plantilla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clásica' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    expect(screen.getByRole('button', { name: 'Clásica' })).toHaveAttribute('aria-pressed', 'false');
    // el texto vive en dos sitios: la fila del formulario y la tabla del preview
    expect((await screen.findAllByText('CAJA DE REGISTRO')).length).toBeGreaterThan(1);
    expect(document.querySelector('.r2-info')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(mocks.api.informesV2Update).toHaveBeenCalledWith(
      'IV2-0001',
      expect.objectContaining({
        plantilla: 'reservorios2',
        reservorios2: expect.objectContaining({ inspeccion: expect.any(Object) }),
      }),
    );
  });

  it('cambia de plantilla sin informe abierto y las hojas nuevas la usan', async () => {
    mocks.api.informesV2Create.mockResolvedValue({ item: createEmptyInforme(2) });

    render(<InformesV2App />);
    await screen.findByText('ESTACION 1');

    const nueva = screen.getByRole('button', { name: 'Nueva' });
    expect(nueva).not.toBeDisabled();
    fireEvent.click(nueva);

    expect(nueva).toHaveAttribute('aria-pressed', 'true');
    // la vista cambia a la plantilla Reservorios 2 aunque no haya informe abierto
    expect(document.querySelector('.r2-info')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    });
    expect(screen.getByRole('button', { name: 'Nueva' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(mocks.api.informesV2Update).toHaveBeenCalledWith(
      'IV2-0002',
      expect.objectContaining({ plantilla: 'reservorios2' }),
    );
  });

  it('«Nuevo» crea la hoja con la plantilla del informe abierto', async () => {
    mocks.api.informesV2Create.mockResolvedValue({ item: createEmptyInforme(2) });

    render(<InformesV2App />);
    fireEvent.click(await screen.findByText('ESTACION 1'));
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    });

    expect(mocks.api.informesV2Create).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Informe #2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nueva' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.r2-info')).toBeInTheDocument();

    // la plantilla sembrada aún no está en disco: hay que guardarla
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });
    expect(mocks.api.informesV2Update).toHaveBeenCalledWith(
      'IV2-0002',
      expect.objectContaining({ plantilla: 'reservorios2' }),
    );
  });

  it('saves edits through informesV2Update', async () => {
    render(<InformesV2App />);
    fireEvent.click(await screen.findByText('ESTACION 1'));
    await act(async () => Promise.resolve());

    const estacionInput = screen.getByLabelText('Estación');
    fireEvent.change(estacionInput, { target: { value: 'ESTACION 2' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(mocks.api.informesV2Update).toHaveBeenCalledWith(
      'IV2-0001',
      expect.objectContaining({ header: expect.objectContaining({ estacion: 'ESTACION 2' }) }),
    );
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe guardado', type: 'success' });
  });

  it('deletes the selected report after confirm', async () => {
    render(<InformesV2App />);
    fireEvent.click(await screen.findByText('ESTACION 1'));
    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar informe' }));
    });

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
    expect(mocks.api.informesV2Delete).toHaveBeenCalledWith('IV2-0001');
    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'Informe eliminado', type: 'success' });
  });

  it('imports a file through the hidden input with the selected plantilla', async () => {
    const { container } = render(<InformesV2App />);
    await screen.findByText('ESTACION 1');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));

    const input = container.querySelector('input[type="file"][accept=".csv,.xlsx"]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, { target: { files: [new File(['a,b'], 'informes.xlsx')] } });
    });

    await waitFor(() => expect(mocks.api.informesV2ImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'informes.xlsx', plantilla: 'reservorios2' }),
    ));
    expect(mocks.addToast).toHaveBeenCalledWith({ message: '2 informes importados', type: 'success' });
  });

  it('downloads the column template for the selected plantilla', async () => {
    render(<InformesV2App />);
    await screen.findByText('ESTACION 1');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar plantilla' }));
    });

    expect(mocks.api.informesV2DownloadTemplate).toHaveBeenCalledWith('reservorios2');
  });

  it('surfaces a failed list load as an error toast', async () => {
    mocks.api.informesV2List.mockRejectedValue(new Error('backend caído'));
    render(<InformesV2App />);

    await act(async () => Promise.resolve());

    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'backend caído', type: 'error' });
    expect(screen.getByText('No hay informes para mostrar')).toBeInTheDocument();
  });

  it('exports the consolidated report from summaries without loading every full report', async () => {
    render(<InformesV2App />);
    await screen.findByText('ESTACION 1');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Consolidado' }));
    });

    await waitFor(() => expect(mocks.api.informesV2RenderConsolidatedHtml).toHaveBeenCalled());
    expect(mocks.api.informesV2Get).not.toHaveBeenCalled();
  });
});
