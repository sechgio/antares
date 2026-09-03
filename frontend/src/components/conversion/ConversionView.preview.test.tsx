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

describe('ConversionView rename preview single-flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi.formats.mockResolvedValue({ formats: ['JPEG', 'PNG'] });
    mockApi.getFields.mockResolvedValue({ fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] });
    mockApi.getRenamePatterns.mockResolvedValue({ patterns: [] });
    mockApi.getDbColumns.mockResolvedValue({ columns: [], records: [], total: 0 });
    mockApi.preview.mockResolvedValue({ preview: [] });
    mockApi.getStatus.mockResolvedValue({ running: false, progress: 0, current_file: '', ok_count: 0, err_count: 0, logs: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies only the latest preview result when deps change while a request is in flight', async () => {
    let resolveSlow: ((v: unknown) => void) | null = null;
    const slowResult = {
      preview: [{ origen: 'a.jpg', nuevo: 'slow_name.jpg', en_bd: true }],
    };
    const fastResult = {
      preview: [{ origen: 'a.jpg', nuevo: 'fast_name.jpg', en_bd: true }],
    };

    mockApi.preview
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValueOnce(fastResult);

    mockApi.dialogFiles.mockResolvedValueOnce({
      paths: ['C:\\fotos\\a.jpg'],
      file_tokens: ['antares-read_a'],
    });

    renderView();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() => expect(mockApi.preview).toHaveBeenCalledTimes(1));

    mockApi.dialogFiles.mockResolvedValueOnce({
      paths: ['C:\\fotos\\b.jpg'],
      file_tokens: ['antares-read_b'],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Agregar|Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await act(async () => {
      resolveSlow?.(slowResult);
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
    });

    await waitFor(() => {
      expect(mockApi.preview.mock.calls.length).toBeLessThanOrEqual(2);
    });

    await waitFor(() => {
      const lastCall = mockApi.preview.mock.calls.at(-1)?.[0] as { files: string[] };
      expect(lastCall.files).toContain('antares-read_b');
    });
  });

  it('sends the read capability returned by the file dialog to preview', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({
      paths: ['C:\\fotos\\entrada.jpg'],
      file_tokens: ['antares-read_entrada'],
    });

    renderView();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(mockApi.preview).toHaveBeenCalledWith(
        expect.objectContaining({ files: ['antares-read_entrada'] }),
      );
    });
  });

  it('does not re-fetch when auto-detected key column is applied (call count ≤ 2, ideally 1)', async () => {
    mockApi.getDbColumns.mockResolvedValue({
      columns: ['codigo', 'nombre'],
      records: [
        { codigo: '4210502', nombre: 'Alpha' },
        { codigo: '4210503', nombre: 'Beta' },
      ],
      total: 2,
    });
    mockApi.preview.mockResolvedValue({
      preview: [{ origen: '4210502.jpg', nuevo: '4210502_Alpha.jpg', en_bd: true }],
      detected_key_column: 'codigo',
      detected_key_column_matches: 1,
    });
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\4210502.jpg'] });

    renderView();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => expect(mockApi.preview).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
      await Promise.resolve();
    });

    expect(mockApi.preview.mock.calls.length).toBeLessThanOrEqual(2);

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect((select as HTMLSelectElement).value).toBe('codigo');
    });
  });

  it('re-runs preview when the user manually changes the key column', async () => {
    mockApi.getDbColumns.mockResolvedValue({
      columns: ['codigo', 'nombre'],
      records: [
        { codigo: '4210502', nombre: 'Alpha' },
      ],
      total: 1,
    });
    mockApi.preview.mockResolvedValue({
      preview: [{ origen: '4210502.jpg', nuevo: 'x.jpg', en_bd: true }],
      detected_key_column: 'codigo',
      detected_key_column_matches: 1,
    });
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\4210502.jpg'] });

    renderView();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() => expect(mockApi.preview).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const callsAfterDetect = mockApi.preview.mock.calls.length;

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'nombre' } });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(mockApi.preview.mock.calls.length).toBeGreaterThan(callsAfterDetect);
    });
    const lastBody = mockApi.preview.mock.calls.at(-1)?.[0] as { key_column?: string };
    expect(lastBody.key_column).toBe('nombre');
  });

  it('mapping mode still sends {renombre}{ext} body', async () => {
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
    mockApi.preview.mockResolvedValue({
      preview: [{ origen: 'IMG_0001.jpg', nuevo: 'fachada_norte.jpg', en_bd: true }],
    });

    renderView();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\mapeo\\renombres.xlsx'] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Base de datos|BD/i }));
    });
    await waitFor(() => expect(mockApi.dbParseMapping).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Mapeo directo activo')).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(mockApi.preview).toHaveBeenCalledWith(
        expect.objectContaining({
          patron: '{renombre}{ext}',
          mapping: { 'IMG_0001.jpg': 'fachada_norte' },
        }),
      );
    });
  });
});
