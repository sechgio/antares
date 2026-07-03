import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgStatus: vi.fn(async () => ({ connected: false, autoSync: false })),
    autoimgSyncFromSheet: vi.fn(async () => ({ success: true, rows: [] })),
    autoimgSheetsReadRange: vi.fn(async () => ({ values: [] })),
    autoimgOAuthConfigStatus: vi.fn(async () => ({ configured: false })),
    autoimgSheetsAuthStatus: vi.fn(async () => ({ authenticated: false })),
    autoimgSheetsGetConfig: vi.fn(async () => ({ sheet_id: '', name: '', linked: false })),
    autoimgFoldersList: vi.fn(async () => ({ folders: [] })),
    autoimgDriveStatus: vi.fn(async () => ({ connected: false })),
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

  it('renders unified header and tab buttons in the top bar', () => {
    render(<AutoIMGApp />);
    expect(screen.getByRole('heading', { name: 'AutoIMG' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });

  it('keeps sidebar panels visible when switching tabs', () => {
    render(<AutoIMGApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Carpetas' }));
    expect(screen.getByText('Credenciales OAuth')).toBeInTheDocument();
    expect(screen.getByText('Nueva carpeta')).toBeInTheDocument();
  });
});