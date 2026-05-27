import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
