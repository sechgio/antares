import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgSyncFromSheet: vi.fn(async () => ({ success: true, rows: [] })),
    autoimgSyncToSheet: vi.fn(),
    autoimgScanAndSync: vi.fn(),
    autoimgCancelOperation: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
  onNotify: () => () => {},
}));

import SyncActions from './SyncActions';

describe('SyncActions refresh notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the IPC completion event as the only sync-from refresh signal', async () => {
    const onSynced = vi.fn();
    render(<SyncActions onSynced={onSynced} />);

    fireEvent.click(screen.getByRole('button', { name: 'Leer' }));
    await waitFor(() => expect(mockApi.autoimgSyncFromSheet).toHaveBeenCalledTimes(1));

    expect(onSynced).not.toHaveBeenCalled();
  });

  it('reports a successful sync with unpersisted metadata as partial', async () => {
    mockApi.autoimgSyncToSheet.mockResolvedValue({
      success: true,
      updated: 3,
      new_rows: 0,
      logs: ['3 filas sincronizadas'],
      partial: true,
      config_persisted: false,
      warning: 'configuración de solo lectura',
    });
    const onStatus = vi.fn();
    render(<SyncActions onStatus={onStatus} />);

    fireEvent.click(screen.getByRole('button', { name: 'Escribir' }));

    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({ error: 'configuración de solo lectura' }));
  });
});
