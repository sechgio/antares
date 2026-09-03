import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgFoldersList: vi.fn(async () => ({ folders: [] })),
    autoimgFoldersAdd: vi.fn(async () => ({ success: true })),
    autoimgFoldersRemove: vi.fn(async () => ({ success: true })),
    autoimgFoldersToggle: vi.fn(async () => ({ success: true })),
    autoimgDriveVerifyFolder: vi.fn(async () => ({
      accessible: true,
      folder_id: '1abcXYZ_123',
      name: 'Carpeta Drive',
      image_count: 3,
      sample_files: [],
    })),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
}));

import FolderMgmt from './FolderMgmt';

describe('FolderMgmt — Nueva carpeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('habilita Agregar con URL/ID sin exigir Verificar previo', async () => {
    render(<FolderMgmt folders={[]} />);

    const addBtn = screen.getByRole('button', { name: 'Agregar' });
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Nombre descriptivo'), {
      target: { value: 'Pedro' },
    });
    fireEvent.change(screen.getByPlaceholderText('URL o Folder ID de Drive'), {
      target: { value: 'https://drive.google.com/drive/folders/1abcXYZ_123' },
    });

    await waitFor(() => {
      expect(addBtn).not.toBeDisabled();
    });
  });

  it('agrega carpeta con nombre + ID sin pasar por Verificar', async () => {
    const onFoldersChange = vi.fn(async () => {});
    render(<FolderMgmt folders={[]} onFoldersChange={onFoldersChange} />);

    fireEvent.change(screen.getByPlaceholderText('Nombre descriptivo'), {
      target: { value: 'Pedro' },
    });
    fireEvent.change(screen.getByPlaceholderText('URL o Folder ID de Drive'), {
      target: { value: '1abcXYZ_123' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => {
      expect(mockApi.autoimgFoldersAdd).toHaveBeenCalledWith({
        name: 'Pedro',
        folder_id: '1abcXYZ_123',
        activo: true,
      });
    });
    expect(mockApi.autoimgDriveVerifyFolder).not.toHaveBeenCalled();
    expect(onFoldersChange).toHaveBeenCalled();
  });

  it('si falta nombre, verifica en Drive y usa el nombre de la carpeta', async () => {
    render(<FolderMgmt folders={[]} />);

    fireEvent.change(screen.getByPlaceholderText('URL o Folder ID de Drive'), {
      target: { value: '1abcXYZ_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => {
      expect(mockApi.autoimgDriveVerifyFolder).toHaveBeenCalledWith('1abcXYZ_123');
      expect(mockApi.autoimgFoldersAdd).toHaveBeenCalledWith({
        name: 'Carpeta Drive',
        folder_id: '1abcXYZ_123',
        activo: true,
      });
    });
  });

  it('usa la lista devuelta por la mutación sin recargar carpetas', async () => {
    const existing = {
      name: 'Actual',
      folder_id: '1actualFolder_1',
      activo: true,
      ultimo_scan: '',
      cant_archivos: 0,
    };
    const nextFolders = [
      existing,
      {
        name: 'Nueva',
        folder_id: '1newFolder_123',
        activo: true,
        ultimo_scan: '',
        cant_archivos: 0,
      },
    ];
    const onFoldersChange = vi.fn(async () => {});
    mockApi.autoimgFoldersAdd.mockImplementationOnce(async () => ({
      success: true,
      folders: nextFolders,
    }));
    render(<FolderMgmt folders={[existing]} onFoldersChange={onFoldersChange} />);

    fireEvent.change(screen.getByPlaceholderText('Nombre descriptivo'), {
      target: { value: 'Nueva' },
    });
    fireEvent.change(screen.getByPlaceholderText('URL o Folder ID de Drive'), {
      target: { value: '1newFolder_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => {
      expect(mockApi.autoimgFoldersAdd).toHaveBeenCalledWith({
        name: 'Nueva',
        folder_id: '1newFolder_123',
        activo: true,
      });
    });
    expect(mockApi.autoimgFoldersList).not.toHaveBeenCalled();
    expect(onFoldersChange).toHaveBeenCalledWith(nextFolders);
    expect(screen.getByText('Nueva')).toBeInTheDocument();
  });
});
