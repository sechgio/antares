import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgAutoSyncToggle: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
  onNotify: () => () => {},
}));

import SyncPanel from './SyncPanel';

describe('SyncPanel auto-sync persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a partial-result error when auto-sync changes only for the current session', async () => {
    mockApi.autoimgAutoSyncToggle.mockResolvedValue({
      enabled: true,
      persisted: false,
      error: 'configuración de solo lectura',
    });
    const onAutoSyncChange = vi.fn();
    render(<SyncPanel autoSync={false} onAutoSyncChange={onAutoSyncChange} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Actualizar desde Sheet cada 5 minutos' }));

    expect(await screen.findByText('configuración de solo lectura')).toBeInTheDocument();
    expect(onAutoSyncChange).toHaveBeenCalledWith(true);
  });
});
