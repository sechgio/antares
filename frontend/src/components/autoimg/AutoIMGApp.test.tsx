import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi, notifyState } = vi.hoisted(() => ({
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
    autoimgScanAndSync: vi.fn(async () => ({ success: true })),
  },
  notifyState: {
    callback: null as ((method: string, params?: unknown) => void) | null,
  },
}));

vi.mock('../../api', () => ({
  api: mockApi,
  onNotify: (cb: (method: string, params?: unknown) => void) => {
    notifyState.callback = cb;
    return () => {
      notifyState.callback = null;
    };
  },
}));

import AutoIMGApp from './AutoIMGApp';

describe('AutoIMGApp layout and navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyState.callback = null;
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
    expect(screen.getByText('Carpetas registradas')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('renders coverage status next to scan actions in the header', async () => {
    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AutoIMG' })).toBeInTheDocument();
    });
    expect(screen.getByRole('status', { name: 'Cobertura y auto-sync' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Operaciones de sincronización' })).toBeInTheDocument();
    expect(screen.getByText('Sin datos de cobertura')).toBeInTheDocument();
  });

  it('loads bootstrap once on mount', async () => {
    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(mockApi.autoimgBootstrap).toHaveBeenCalledWith(true);
    });
  });

  it('coalesces refresh events while a bootstrap is already in flight', async () => {
    let resolveBootstrap!: (value: Awaited<ReturnType<typeof mockApi.autoimgBootstrap>>) => void;
    const pendingBootstrap = new Promise<Awaited<ReturnType<typeof mockApi.autoimgBootstrap>>>((resolve) => {
      resolveBootstrap = resolve;
    });
    const bootstrapData = {
      connected: true,
      sheetLinked: true,
      lastSync: '',
      autoSync: false,
      folders: [],
      bdRows: [],
      logRows: [],
      arrastre: [],
    };
    mockApi.autoimgBootstrap.mockImplementation(() => pendingBootstrap);

    render(<AutoIMGApp />);
    await waitFor(() => {
      expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(1);
      expect(notifyState.callback).toBeTruthy();
    });

    notifyState.callback!('autoimg.sync.from_complete', { cached: true });
    notifyState.callback!('autoimg.sync.from_complete');

    expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(1);
    resolveBootstrap(bootstrapData);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'AutoIMG' })).toBeInTheDocument());
  });
});

describe('AutoIMGApp bootstrap refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyState.callback = null;
  });

  it('keeps valid coverage and folders without refreshing an unchanged Sheet', async () => {
    const bootstrap = {
      connected: true, sheetLinked: true, lastSync: '2026-07-03', autoSync: false,
      totalNis: 10, completos: 8, faltantes: 2,
      folders: [{ name: 'Cached folder', folder_id: 'abc', activo: true, ultimo_scan: '', cant_archivos: 0 }],
      bdRows: [], logRows: [], arrastre: [],
    };
    mockApi.autoimgBootstrap.mockResolvedValue(bootstrap);
    render(<AutoIMGApp />);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Cobertura y auto-sync' })).toHaveTextContent(/8\s*\/\s*10/));
    act(() => {
      notifyState.callback!('autoimg.sync.from_complete', { cached: true });
      notifyState.callback!('autoimg.sync.from_complete', { cached: true });
    });
    expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Carpetas' }));
    expect(screen.getByText('Cached folder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: /Escanear/ }));
    await waitFor(() => expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(2));
    expect(mockApi.autoimgBootstrap).toHaveBeenLastCalledWith(true);
  });

  it.each([undefined, { cached: false }, { cached: 'true' }])('refreshes when cached is not explicitly true: %j', async (params) => {
    mockApi.autoimgBootstrap.mockResolvedValue({
      connected: true, sheetLinked: true, lastSync: '', autoSync: false,
      folders: [], bdRows: [], logRows: [], arrastre: [],
    });
    render(<AutoIMGApp />);
    await screen.findByRole('button', { name: /Escanear/ });
    await act(async () => { notifyState.callback!('autoimg.sync.from_complete', params); });
    expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(2);
    expect(mockApi.autoimgBootstrap).toHaveBeenLastCalledWith(true);
  });

  it.each([
    { connected: false, sheetLinked: true },
    { connected: true, sheetLinked: false },
    { connected: true, sheetLinked: true, error: 'Lectura fallida' },
  ])('refreshes cached notifications without a valid snapshot: %j', async (status) => {
    mockApi.autoimgBootstrap.mockResolvedValue({
      ...status, lastSync: '', autoSync: false, folders: [], bdRows: [], logRows: [], arrastre: [],
    });
    render(<AutoIMGApp />);
    await act(async () => {});
    await act(async () => { notifyState.callback!('autoimg.sync.from_complete', { cached: true }); });
    expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(2);
  });

  it('starts a new bootstrap after the previous one completes', async () => {
    const staleBootstrap = {
      connected: true,
      sheetLinked: true,
      lastSync: '',
      autoSync: false,
      folders: [{ name: 'Stale', folder_id: 'old', activo: true, ultimo_scan: '', cant_archivos: 0 }],
      bdRows: [],
      logRows: [],
      arrastre: [],
    };
    const freshBootstrap = {
      connected: true,
      sheetLinked: true,
      lastSync: '2026-07-03',
      autoSync: false,
      folders: [{ name: 'Fresh', folder_id: 'new', activo: true, ultimo_scan: '', cant_archivos: 0 }],
      bdRows: [],
      logRows: [],
      arrastre: [],
    };

    mockApi.autoimgBootstrap
      .mockImplementationOnce(async () => staleBootstrap)
      .mockImplementationOnce(async () => freshBootstrap);

    render(<AutoIMGApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Carpetas' }));
    await waitFor(() => {
      expect(notifyState.callback).toBeTruthy();
      expect(screen.getByText('Stale')).toBeInTheDocument();
    });
    notifyState.callback!('autoimg.sync.from_complete');

    await waitFor(() => {
      expect(screen.getByText('Fresh')).toBeInTheDocument();
    });
    expect(mockApi.autoimgBootstrap).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });
});
