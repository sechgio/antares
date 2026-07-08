import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgBootstrap: vi.fn(async () => ({
      connected: true,
      sheetLinked: true,
      lastSync: '2026-07-03',
      autoSync: false,
      folders: [{ name: 'Test', folder_id: 'abc', activo: true, ultimo_scan: '', cant_archivos: 0 }],
      bdRows: [],
      logRows: [],
      arrastre: [],
    })),
    autoimgOAuthConfigStatus: vi.fn(async () => ({ configured: true })),
    autoimgSheetsAuthStatus: vi.fn(async () => ({ authenticated: false })),
    autoimgSheetsGetConfig: vi.fn(async () => ({ sheet_id: '', name: '', linked: false })),
    autoimgFoldersList: vi.fn(async () => ({ folders: [] })),
    autoimgDriveStatus: vi.fn(async () => ({ connected: false })),
    autoimgLogsList: vi.fn(async () => ({ values: [] })),
    autoimgArrastreList: vi.fn(async () => ({ entries: [] })),
  },
}));

vi.mock('../../api', () => ({
  api: mockApi,
  onNotify: () => () => {},
}));

import AutoIMGApp from './AutoIMGApp';

describe('AutoIMGApp layout and navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders unified header and tab buttons in the top bar', async () => {
    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AutoIMG' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });

  it('keeps sidebar panels visible when switching tabs', async () => {
    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Carpetas' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Carpetas' }));
    expect(screen.getByText('Conexión')).toBeInTheDocument();
    expect(screen.getByText('OAuth')).toBeInTheDocument();
    expect(screen.getByText('Nueva carpeta')).toBeInTheDocument();
  });

  it('loads bootstrap once on mount', async () => {
    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(mockApi.autoimgBootstrap).toHaveBeenCalledWith(true);
    });
  });
});