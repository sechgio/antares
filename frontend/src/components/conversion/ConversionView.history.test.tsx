import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import { DialogProvider } from '../../hooks/useDialog';
import type { HistoryRun } from '../history/RunList';

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

const historyMocks = vi.hoisted(() => ({
  pending: null as HistoryRun | null,
  takePendingHistoryReexecute: vi.fn(() => {
    const run = historyMocks.pending;
    historyMocks.pending = null;
    return run;
  }),
  subscribeHistoryReexecute: vi.fn(() => () => {}),
}));

vi.mock('../../api', () => ({ api: mockApi, onNotify: () => () => {} }));
vi.mock('../history/historyEvents', () => ({
  subscribeHistoryReexecute: historyMocks.subscribeHistoryReexecute,
  takePendingHistoryReexecute: historyMocks.takePendingHistoryReexecute,
}));

import ConversionView from './ConversionView';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const filenameHistoryRun = (): HistoryRun => ({
  id: 42,
  run_type: 'conversion',
  timestamp: '2026-01-01T00:00:00',
  formato: 'JPEG',
  calidad: 95,
  ok_count: 1,
  err_count: 0,
  patron: '{codigo}_{seq}{ext}',
  files_json: JSON.stringify(['C:\\fotos\\4210502 (7).jpg']),
  options_json: JSON.stringify({
    destino: 'C:\\salida',
    sequence_mode: 'filename',
    use_filename_seq: true,
    usar_rename: true,
    conversion_enabled: true,
  }),
});

describe('ConversionView history sequence_mode restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyMocks.pending = filenameHistoryRun();
    mockApi.formats.mockResolvedValue({ formats: ['JPEG', 'PNG'] });
    mockApi.getFields.mockResolvedValue({ fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] });
    mockApi.getRenamePatterns.mockResolvedValue({ patterns: [] });
    mockApi.getDbColumns.mockResolvedValue({ columns: [], records: [], total: 0 });
    mockApi.preview.mockResolvedValue({ preview: [] });
    mockApi.getStatus.mockResolvedValue({ running: false, progress: 0, current_file: '', ok_count: 0, err_count: 0, logs: [] });
    mockApi.dialogDest.mockResolvedValue({ paths: ['C:\\salida'] });
  });

  afterEach(() => {
    historyMocks.pending = null;
    vi.restoreAllMocks();
  });

  it('re-runs with sequence_mode filename (does not coerce to record)', async () => {
    render(
      <DialogProvider>
        <ToastProvider>
          <ConversionView />
        </ToastProvider>
      </DialogProvider>,
    );

    await waitFor(() => expect(historyMocks.takePendingHistoryReexecute).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.preview).toHaveBeenCalledWith(
      expect.objectContaining({ sequence_mode: 'filename' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: /Iniciar conversión/i }));
    await waitFor(() => expect(mockApi.startProcess).toHaveBeenCalledWith(
      expect.objectContaining({ sequence_mode: 'filename' }),
    ));
  });
});
