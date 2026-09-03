import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import { DialogProvider } from '../../hooks/useDialog';

const mockApi = vi.hoisted(() => ({
  formats: vi.fn().mockResolvedValue({ formats: ['JPEG', 'PNG'] }),
  getFields: vi.fn().mockResolvedValue({ fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] }),
  getRenamePatterns: vi.fn().mockResolvedValue({ patterns: [] }),
  getDbColumns: vi.fn().mockResolvedValue({ columns: [], records: [], total: 0 }),
  dbParseMapping: vi.fn(),
  importExcel: vi.fn(),
  dialogFiles: vi.fn(),
  dialogDest: vi.fn(),
  dialogFolder: vi.fn().mockResolvedValue({ paths: [] }),
  preview: vi.fn().mockResolvedValue({ preview: [] }),
  startProcess: vi.fn().mockResolvedValue({ started: true }),
  getStatus: vi.fn().mockResolvedValue({ running: false, progress: 0, current_file: '', ok_count: 0, err_count: 0, logs: [] }),
  cancelProcess: vi.fn().mockResolvedValue({ cancelled: true }),
}));

vi.mock('../../api', () => ({ api: mockApi, onNotify: () => () => {} }));

vi.mock('../history/historyEvents', () => ({
  subscribeHistoryReexecute: () => () => {},
  takePendingHistoryReexecute: () => null,
}));

import ConversionView from './ConversionView';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const renderView = () =>
  render(
    <DialogProvider>
      <ToastProvider>
        <ConversionView />
      </ToastProvider>
    </DialogProvider>,
  );

describe('ConversionView mapping auto-detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.formats.mockResolvedValue({ formats: ['JPEG', 'PNG'] });
    mockApi.getFields.mockResolvedValue({ fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] });
    mockApi.getRenamePatterns.mockResolvedValue({ patterns: [] });
    mockApi.getDbColumns.mockResolvedValue({ columns: [], records: [], total: 0 });
    mockApi.preview.mockResolvedValue({ preview: [] });
    mockApi.getStatus.mockResolvedValue({ running: false, progress: 0, current_file: '', ok_count: 0, err_count: 0, logs: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates mapping mode when an ID+RENOMBRE Excel is imported', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\IMG_0001.jpg'] });
    mockApi.dbParseMapping.mockResolvedValueOnce({
      mapping: { 'IMG_0001.jpg': 'fachada_norte' },
      id_column: 'id',
      rename_column: 'renombre',
      columns: ['id', 'renombre'],
      totalEntries: 1,
      matchedFiles: 1,
      unmatchedFiles: [],
      orphanEntries: [],
      collisions: [],
    });

    renderView();

    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\mapeo\\renombres.xlsx'] });

    await act(async () => {
      const dbButton = screen.getByRole('button', { name: /Base de datos|BD/i });
      fireEvent.click(dbButton);
    });

    await waitFor(() => expect(mockApi.dbParseMapping).toHaveBeenCalled());
    expect(mockApi.importExcel).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('Mapeo directo activo')).toBeInTheDocument();
    });
  });

  it('falls back to catalog import when the Excel is not a mapping schema', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\IMG_0001.jpg'] });
    mockApi.dbParseMapping.mockRejectedValueOnce(new Error('No se detectó una columna ID'));
    mockApi.importExcel.mockResolvedValue({ imported: 5 });

    renderView();

    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\catalogo\\productos.xlsx'] });

    await act(async () => {
      const dbButton = screen.getByRole('button', { name: /Base de datos|BD/i });
      fireEvent.click(dbButton);
    });

    await waitFor(() => expect(mockApi.dbParseMapping).toHaveBeenCalled(), { timeout: 5000 });
    await waitFor(() => expect(mockApi.importExcel).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('sends record sequence mode to preview and processing', async () => {
    mockApi.getDbColumns.mockResolvedValue({
      columns: ['codigo'],
      records: [{ codigo: '4210502' }],
      total: 1,
    });
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\4210502 (7).jpg'] });
    mockApi.dialogDest.mockResolvedValueOnce({ paths: ['C:\\salida'] });
    renderView();

    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.preview).toHaveBeenCalledWith(
      expect.objectContaining({ sequence_mode: 'record' }),
    ));

    const perRowLabel = screen.getByText('Por fila de BD');
    const perRowToggle = perRowLabel.parentElement?.parentElement?.querySelector('[role="switch"]');
    expect(perRowToggle).not.toBeNull();
    fireEvent.click(perRowToggle as HTMLElement);
    await waitFor(() => expect(mockApi.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequence_mode: 'global' }),
    ));
    fireEvent.click(perRowToggle as HTMLElement);
    await waitFor(() => expect(mockApi.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequence_mode: 'record' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: /carpeta de destino/i }));
    await waitFor(() => expect(mockApi.dialogDest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Iniciar conversión/i }));
    await waitFor(() => expect(mockApi.startProcess).toHaveBeenCalledWith(
      expect.objectContaining({ sequence_mode: 'record' }),
    ));
  });
});
