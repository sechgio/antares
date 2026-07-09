import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import { DialogProvider } from '../../hooks/useDialog';

// Hoisted mocks — must be defined before the vi.mock call.
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

// jsdom does not implement ResizeObserver — stub it so FileGrid can mount.
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

describe('ConversionView keyboard deletion guard', () => {
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

  it('Backspace while typing in a text input does not delete selected files', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\IMG_0001.jpg'] });
    renderView();

    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    // Add a file.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    // Select all (the FileGrid is virtualized and renders no cards in jsdom,
    // so we rely on the always-rendered "N seleccionado(s)" footer banner to
    // confirm a file loaded AND got selected).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar todo/i }));
    });
    await waitFor(() => expect(screen.getByText('1 seleccionado')).toBeInTheDocument());

    // Simulate the user typing in a text field and pressing Backspace to fix a typo.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'Backspace' });

      // The selection (and the file) must survive — Backspace in an input must
      // not delete it (regression: the window-level handler ignored the target).
      expect(screen.getByText('1 seleccionado')).toBeInTheDocument();
    } finally {
      document.body.removeChild(input);
    }
  });
});

describe('ConversionView start-button double-submit guard', () => {
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

  it('flips the start button to Detener while the start request is in flight (no double submit)', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\IMG_0001.jpg'] });
    mockApi.dialogDest.mockResolvedValueOnce({ paths: ['C:\\salida'] });

    // Stall startProcess so the in-flight window is observable: on the buggy
    // version `running` stays false until the await resolves (up to 30s while
    // the backend boots), so the start button stays clickable and a second
    // click enqueues a second process_start.
    let resolveStart: (v: { started: boolean }) => void = () => {};
    mockApi.startProcess.mockImplementation(
      () => new Promise<{ started: boolean }>((r) => { resolveStart = r; }),
    );

    renderView();
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /carpeta de destino/i }));
    });
    await waitFor(() => expect(mockApi.dialogDest).toHaveBeenCalled());

    // Click start; startProcess is stalled and has NOT resolved yet.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Iniciar conversión/i }));
    });

    // The button must flip to "Detener" immediately (running set before the
    // await), and only one process_start must have been enqueued.
    await waitFor(() => expect(screen.getByRole('button', { name: /Detener/i })).toBeInTheDocument());
    expect(mockApi.startProcess).toHaveBeenCalledTimes(1);

    // A second click now hits "Detener" (cancel), not start — no double submit.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detener/i }));
    });
    expect(mockApi.startProcess).toHaveBeenCalledTimes(1);
    expect(mockApi.cancelProcess).toHaveBeenCalled();

    // Cleanup: release the stalled promise so the component can unmount cleanly.
    await act(async () => { resolveStart({ started: true }); });
  });
});
