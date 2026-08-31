import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import { DialogProvider } from '../../hooks/useDialog';

// Hoisted mocks — must be defined before vi.mock
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

// Capture FileGrid props to assert handler identity stability
const captured = vi.hoisted(() => [] as Array<{ onRemoveFile: (p: string) => void; onFileClick: (e: unknown, p: string) => void; onFileDoubleClick: (e: unknown, p: string) => void }>);

vi.mock('./FileGrid', async () => {
  const actual = await vi.importActual<typeof import('./FileGrid')>('./FileGrid');
  return {
    ...actual,
    default: vi.fn((props: { onRemoveFile: (p: string) => void; onFileClick: (e: unknown, p: string) => void; onFileDoubleClick: (e: unknown, p: string) => void }) => {
      captured.push(props);
      return null;
    }),
  };
});

import ConversionView from './ConversionView';

// jsdom ResizeObserver is stubbed in test-setup, but ensure it exists for ConversionView mount
if (typeof globalThis.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const renderView = () =>
  render(
    <DialogProvider>
      <ToastProvider>
        <ConversionView />
      </ToastProvider>
    </DialogProvider>,
  );

describe('FileGrid handler stability', () => {
  beforeEach(() => {
    captured.length = 0;
    vi.clearAllMocks();
    mockApi.formats.mockResolvedValue({ formats: ['JPEG', 'PNG'] });
    mockApi.getFields.mockResolvedValue({ fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] });
    mockApi.getRenamePatterns.mockResolvedValue({ patterns: [] });
    mockApi.getDbColumns.mockResolvedValue({ columns: [], records: [], total: 0 });
    mockApi.preview.mockResolvedValue({ preview: [] });
    mockApi.getStatus.mockResolvedValue({ running: false, progress: 0, current_file: '', ok_count: 0, err_count: 0, logs: [] });
  });

  it('cellProps stable when parent re-renders without file change', async () => {
    mockApi.dialogFiles.mockResolvedValueOnce({ paths: ['C:\\fotos\\IMG_0001.jpg'] });
    const { rerender } = renderView();
    await waitFor(() => expect(mockApi.getDbColumns).toHaveBeenCalled());

    // Add a file so FileGrid actually mounts (it is hidden when isEmpty)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivos/i }));
    });
    await waitFor(() => expect(mockApi.dialogFiles).toHaveBeenCalled());
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const first = captured.at(-1)!;
    expect(first.onRemoveFile).toBeDefined();
    expect(first.onFileClick).toBeDefined();
    expect(first.onFileDoubleClick).toBeDefined();

    const lenBefore = captured.length;
    // Rerender parent without changing files — simulates progress notification re-render (30-50 cells × 15 nodes)
    rerender(
      <DialogProvider>
        <ToastProvider>
          <ConversionView />
        </ToastProvider>
      </DialogProvider>,
    );
    await waitFor(() => expect(captured.length).toBeGreaterThan(lenBefore));
    const second = captured.at(-1)!;

    // The bug: removeFile was inline, so new identity per render breaks FileGrid.tsx:81 memo
    expect(second.onRemoveFile).toBe(first.onRemoveFile);
    expect(second.onFileClick).toBe(first.onFileClick);
    expect(second.onFileDoubleClick).toBe(first.onFileDoubleClick);
  });

  it('FileGrid cellProps memo does not recreate when handlers are stable', async () => {
    // This is a static file-content check that will fail before the useCallback fix
    // and pass after — supplements the runtime identity check above.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(process.cwd(), 'src/components/conversion/ConversionView.tsx');
    // process.cwd() is frontend/ when vitest runs, so resolve relative
    const text = fs.readFileSync(filePath, 'utf-8');
    // removeFile must be wrapped with useCallback to keep identity stable
    expect(text).toMatch(/const removeFile\s*=\s*useCallback/);
    // removeSelectedFiles should also be stable (optional but desired)
    expect(text).toMatch(/const removeSelectedFiles\s*=\s*useCallback/);
  });
});
