import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  confirm: vi.fn(),
  api: {
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
    mocks.api.informesV2List.mockResolvedValue({ reports: [listItem] });
    mocks.api.informesV2Get.mockResolvedValue({ report });
    mocks.api.informesV2Update.mockResolvedValue({ success: true, report });
    mocks.api.informesV2Delete.mockResolvedValue({ deleted: true });
    mocks.api.informesV2Clear.mockResolvedValue({});
    mocks.api.informesV2ImportFile.mockResolvedValue({ imported_count: 2 });
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

  it('imports a file through the hidden input', async () => {
    const { container } = render(<InformesV2App />);
    await screen.findByText('ESTACION 1');

    const input = container.querySelector('input[type="file"][accept=".csv,.xlsx"]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, { target: { files: [new File(['a,b'], 'informes.xlsx')] } });
    });

    await waitFor(() => expect(mocks.api.informesV2ImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'informes.xlsx' }),
    ));
    expect(mocks.addToast).toHaveBeenCalledWith({ message: '2 informes importados', type: 'success' });
  });

  it('surfaces a failed list load as an error toast', async () => {
    mocks.api.informesV2List.mockRejectedValue(new Error('backend caído'));
    render(<InformesV2App />);

    await act(async () => Promise.resolve());

    expect(mocks.addToast).toHaveBeenCalledWith({ message: 'backend caído', type: 'error' });
    expect(screen.getByText('No hay informes para mostrar')).toBeInTheDocument();
  });
});
