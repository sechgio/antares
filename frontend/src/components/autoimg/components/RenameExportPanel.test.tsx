import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgRenameDestConfig: vi.fn(),
    autoimgRenameExport: vi.fn(),
    autoimgDriveVerifyFolder: vi.fn(),
    autoimgCancelOperation: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
  onNotify: () => () => {},
}));

import RenameExportPanel from './RenameExportPanel';

describe('RenameExportPanel partial outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.autoimgRenameDestConfig.mockResolvedValue({ folder_id: '' });
    mockApi.autoimgRenameExport.mockResolvedValue({
      success: true,
      dest_folder_id: 'folder-1',
      dest_name: 'Destino',
      destinos: [],
      folders_created: [],
      planned: 1,
      copied: [{ nis: '1', sgio: '12345678', slot: 1, from: '1.jpg', to: '12345678_1.jpg', file_id: 'file-1' }],
      failed: [],
      skipped: [],
      partial: true,
      config_persisted: false,
      warning: 'configuración de solo lectura',
    });
  });

  it('keeps the completed copy result and surfaces the metadata persistence warning', async () => {
    render(<RenameExportPanel />);
    fireEvent.change(screen.getByPlaceholderText('URL o Folder ID de Drive (raíz)'), {
      target: { value: 'folder-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Renombrar y organizar/ }));

    expect(await screen.findByText('configuración de solo lectura')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Destino')).toBeInTheDocument());
  });
});
