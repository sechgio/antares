import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgSyncFromSheet: vi.fn(async () => ({ success: true, rows: [] })),
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
});
