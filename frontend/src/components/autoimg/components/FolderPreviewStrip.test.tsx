import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    autoimgDriveFolderPreview: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: mockApi,
}));

import { FolderPreviewStrip, useFolderPreviews } from './FolderPreviewStrip';

function PreviewHost({ ids }: { ids: string[] }) {
  const { previews } = useFolderPreviews(ids);
  return (
    <div>
      {ids.map((id) => (
        <FolderPreviewStrip key={id} state={previews[id]} folderName={id} />
      ))}
    </div>
  );
}

describe('FolderPreviewStrip / useFolderPreviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carga miniaturas y las muestra', async () => {
    mockApi.autoimgDriveFolderPreview.mockResolvedValue({
      folder_id: 'folder-1',
      thumbs: [
        { id: 'a', name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,aaa' },
        { id: 'b', name: 'b.jpg', dataUrl: 'data:image/jpeg;base64,bbb' },
      ],
    });

    render(<PreviewHost ids={['folder-1']} />);

    await waitFor(() => {
      expect(screen.getByAltText('a.jpg')).toBeInTheDocument();
      expect(screen.getByAltText('b.jpg')).toBeInTheDocument();
    });
    expect(mockApi.autoimgDriveFolderPreview).toHaveBeenCalledWith('folder-1');
  });

  it('muestra fallback si no hay miniaturas', async () => {
    mockApi.autoimgDriveFolderPreview.mockResolvedValue({
      folder_id: 'folder-empty',
      thumbs: [],
    });

    render(<PreviewHost ids={['folder-empty']} />);

    await waitFor(() => {
      expect(screen.getByText('Sin miniaturas')).toBeInTheDocument();
    });
  });
});
