import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgOAuthConfigStatus: vi.fn(),
    autoimgSheetsAuthStatus: vi.fn(),
    autoimgSheetsGetConfig: vi.fn(),
    autoimgSheetsOpen: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
  onNotify: () => () => {},
}));

import GoogleAuthPanel from './GoogleAuthPanel';

describe('GoogleAuthPanel Sheet persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.autoimgOAuthConfigStatus.mockResolvedValue({ configured: true, client_id_masked: 'client…test' });
    mockApi.autoimgSheetsAuthStatus.mockResolvedValue({ authenticated: true, email: 'user@example.com' });
    mockApi.autoimgSheetsGetConfig.mockResolvedValue({ sheet_id: '', name: '', linked: false });
  });

  it('shows that a Sheet opened but its configuration was not persisted', async () => {
    mockApi.autoimgSheetsOpen.mockResolvedValue({
      success: true,
      sheet_id: '1AbCdEfGhIjKlMnOpQrSt',
      name: 'AutoIMG',
      config_persisted: false,
      config_error: 'configuración de solo lectura',
    });
    const onSheetLinked = vi.fn();
    render(<GoogleAuthPanel onSheetLinked={onSheetLinked} />);

    const input = await screen.findByPlaceholderText('URL o ID del Sheet');
    fireEvent.change(input, { target: { value: '1AbCdEfGhIjKlMnOpQrSt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    expect(await screen.findByText('configuración de solo lectura')).toBeInTheDocument();
    expect(onSheetLinked).toHaveBeenCalledTimes(1);
  });
});
