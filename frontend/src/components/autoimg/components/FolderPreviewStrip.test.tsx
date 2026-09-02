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

function DynamicPreviewHost({ ids }: { ids: string[] }) {
  const { previews } = useFolderPreviews(ids);
  return (
    <div>
      <span data-testid="preview-state">{previews['folder-reset']?.status ?? 'missing'}</span>
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

  it('no conserva una segunda copia al desmontar y volver a montar', async () => {
    mockApi.autoimgDriveFolderPreview.mockResolvedValue({
      folder_id: 'folder-remount',
      thumbs: [{ id: 'a', name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,aaa' }],
    });

    const first = render(<PreviewHost ids={['folder-remount']} />);
    await waitFor(() => expect(screen.getByAltText('a.jpg')).toBeInTheDocument());
    first.unmount();

    render(<PreviewHost ids={['folder-remount']} />);
    await waitFor(() => expect(mockApi.autoimgDriveFolderPreview).toHaveBeenCalledTimes(2));
  });

  it('limpia previews montadas al vaciar la sesión', async () => {
    let resolveReload: ((value: unknown) => void) | undefined;
    mockApi.autoimgDriveFolderPreview
      .mockResolvedValueOnce({
        folder_id: 'folder-reset',
        thumbs: [{ id: 'a', name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,aaa' }],
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReload = resolve; }));

    const view = render(<DynamicPreviewHost ids={['folder-reset']} />);
    await waitFor(() => expect(screen.getByAltText('a.jpg')).toBeInTheDocument());

    view.rerender(<DynamicPreviewHost ids={[]} />);
    await waitFor(() => expect(screen.getByTestId('preview-state')).toHaveTextContent('missing'));

    view.rerender(<DynamicPreviewHost ids={['folder-reset']} />);
    await waitFor(() => expect(screen.getByTestId('preview-state')).toHaveTextContent('loading'));
    expect(screen.queryByAltText('a.jpg')).not.toBeInTheDocument();

    resolveReload?.({
      folder_id: 'folder-reset',
      thumbs: [{ id: 'b', name: 'b.jpg', dataUrl: 'data:image/jpeg;base64,bbb' }],
    });
    await waitFor(() => expect(screen.getByAltText('b.jpg')).toBeInTheDocument());
  });
});
