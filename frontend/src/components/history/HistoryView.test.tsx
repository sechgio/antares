import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { DialogProvider } from '../../hooks/useDialog';
import { ToastProvider } from '../../hooks/useToast';
import HistoryView from './HistoryView';
import type { HistoryRun } from './RunList';

function makeRun(id: number): HistoryRun {
  return {
    id,
    run_type: 'conversion',
    timestamp: new Date(2026, 0, 1, 8, id % 60).toISOString(),
    formato: `JPEG-${id}`,
    calidad: 90,
    ok_count: 1,
    err_count: 0,
    patron: '{codigo}{ext}',
    files_json: JSON.stringify([`foto-${id}.jpg`]),
    options_json: '{}',
  };
}

function renderHistoryView() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <HistoryView />
      </DialogProvider>
    </ToastProvider>,
  );
}

describe('HistoryView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads history in pages instead of fetching every run at once', async () => {
    const firstResponse = Array.from({ length: 51 }, (_, index) => makeRun(index + 1));
    const secondResponse = [makeRun(51), makeRun(52), makeRun(53)];
    const electronApi = window.electronAPI!;
    const invoke = vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'history_list') return {};
      return {
        runs: params?.offset === 50 ? secondResponse : firstResponse,
      };
    });

    renderHistoryView();

    expect(await screen.findByText('JPEG-1')).toBeInTheDocument();
    expect(screen.getByText('Cargar más')).toBeInTheDocument();
    expect(screen.queryByText('JPEG-51')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Cargar más'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('history_list', { limit: 51, offset: 50 });
    });
    expect(await screen.findByText('JPEG-53')).toBeInTheDocument();
  });

  it('exports CSV of the current filter set when no rows are selected', async () => {
    const rows = [makeRun(1), makeRun(2)];
    const electronApi = window.electronAPI!;
    const invoke = vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'history_list') return { runs: rows };
      if (method === 'history_export') {
        // Minimal valid base64 (header row only)
        return { csv: 'aWQscnVuX3R5cGU=', count: 2 };
      }
      return {};
    });

    // jsdom does not implement URL.createObjectURL out of the box; stub it.
    const createObjectUrl = vi.fn(() => 'blob:mock');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true });
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    }) as typeof document.createElement);

    renderHistoryView();
    expect(await screen.findByText('JPEG-1')).toBeInTheDocument();

    const exportBtn = await screen.findByTestId('history-export-csv');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('history_export', expect.objectContaining({}));
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('exports only selected rows when checkboxes are checked', async () => {
    const rows = [makeRun(1), makeRun(2), makeRun(3)];
    const electronApi = window.electronAPI!;
    const invoke = vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'history_list') return { runs: rows };
      if (method === 'history_export') return { csv: 'aWQscnVuX3R5cGU=', count: 2 };
      return {};
    });

    const createObjectUrl = vi.fn(() => 'blob:mock');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    }) as typeof document.createElement);

    renderHistoryView();
    expect(await screen.findByText('JPEG-1')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(await screen.findByTestId('history-export-csv'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('history_export', { ids: [1, 2] });
    });
  });

  it('shows a bulk bar with delete button when rows are selected', async () => {
    const rows = [makeRun(1), makeRun(2)];
    const electronApi = window.electronAPI!;
    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'history_list') return { runs: rows };
      return {};
    });

    renderHistoryView();
    expect(await screen.findByText('JPEG-1')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);

    fireEvent.click(checkboxes[0]);
    expect(await screen.findByTestId('history-bulk-bar')).toBeInTheDocument();
  });
});
