import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({
  dialogFolder: vi.fn().mockResolvedValue({ paths: [], folder: '' }),
  imageOptimizerSaveFiles: vi.fn(),
}));

const mockPipeline = vi.hoisted(() => ({
  createImageItem: vi.fn(async (file: File) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sourceFile: file,
    preview: 'blob:stub',
    originalName: file.name,
    originalSize: file.size,
    sourceWidth: 100,
    sourceHeight: 100,
    status: 'pending' as const,
    stale: false,
    selected: false,
    excluded: false,
    overrides: {
      customFilename: '',
      customCropOffset: undefined,
      excluded: false,
      skipCompression: false,
      presetId: null,
    },
  })),
  processImageItem: vi.fn(async () => {
    throw new Error('processImageItem not used in this test suite');
  }),
}));

vi.mock('../../api', () => ({ api: mockApi }));
vi.mock('../../utils/history', () => ({ saveFeatureHistory: vi.fn() }));
vi.mock('./pipeline', () => ({
  createImageItem: mockPipeline.createImageItem,
  processImageItem: mockPipeline.processImageItem,
}));

import ImageOptimizer from './index';
import { ImageItem } from './types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

function makeDownloadableItem(id: string, originalName: string): ImageItem {
  const blob = new Blob(['pixel-data'], { type: 'image/jpeg' });
  const file = new File([blob], originalName, { type: 'image/jpeg' });
  return {
    id,
    originalName,
    sourceFile: file,
    preview: '',
    originalSize: blob.size,
    status: 'pending',
    stale: false,
    selected: false,
    excluded: false,
    overrides: {
      customFilename: '',
      customCropOffset: undefined,
      excluded: false,
      skipCompression: false,
      presetId: null,
    },
  };
}

async function mountAndAddFiles(items: ImageItem[]): Promise<void> {
  render(<ImageOptimizer />);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Solo renombrar/i }));
  });

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();

  const files = items.map((item) => item.sourceFile);
  Object.defineProperty(input, 'files', {
    value: files,
    writable: false,
    configurable: true,
  });

  await act(async () => {
    fireEvent.change(input);
  });

  await waitFor(() => {
    expect(screen.queryByText(/agregada|agregado/i)).toBeTruthy();
  });
}

describe('ImageOptimizer download menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.dialogFolder.mockResolvedValue({ paths: [], folder: '' });
    mockApi.imageOptimizerSaveFiles.mockResolvedValue({
      saved_path: '/tmp/out',
      saved_count: 0,
      skipped_count: 0,
      saved: [],
      skipped: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the download chevron with a single downloadable image', async () => {
    await mountAndAddFiles([makeDownloadableItem('a', 'foto.jpg')]);
    expect(screen.getByLabelText('Opciones de descarga')).toBeInTheDocument();
  });

  it('aborts active processing when the optimizer unmounts', async () => {
    let observedSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const processing = new Promise<never>((resolve) => {
      release = resolve;
    });
    mockPipeline.processImageItem.mockImplementation((_item, _settings, signal) => {
      observedSignal = signal;
      return processing;
    });

    const { unmount } = render(<ImageOptimizer />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pixel-data'], 'foto.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
      configurable: true,
    });

    await act(async () => {
      fireEvent.change(input);
    });
    await waitFor(() => expect(screen.queryByText(/agregada|agregado/i)).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Procesar' }));
    });
    await waitFor(() => expect(mockPipeline.processImageItem).toHaveBeenCalled());

    unmount();
    expect(observedSignal?.aborted).toBe(true);
    release?.();
    await act(async () => {});
  });

  it('reveals individual export option when the chevron is clicked', async () => {
    await mountAndAddFiles([makeDownloadableItem('a', 'foto.jpg')]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opciones de descarga'));
    });

    expect(screen.getByRole('menuitem', { name: /Descargar individual a carpeta/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Descargar como ZIP/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Guardar en carpeta/i })).not.toBeInTheDocument();
  });

  it('shows both download options with multiple downloadable images', async () => {
    await mountAndAddFiles([
      makeDownloadableItem('a', 'foto1.jpg'),
      makeDownloadableItem('b', 'foto2.jpg'),
    ]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opciones de descarga'));
    });

    expect(screen.getByRole('menuitem', { name: /Descargar como ZIP/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Descargar individual a carpeta/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Guardar en carpeta/i })).not.toBeInTheDocument();
  });

  it('warns when "Descargar individual a carpeta" is clicked without output folder', async () => {
    await mountAndAddFiles([
      makeDownloadableItem('a', 'foto1.jpg'),
      makeDownloadableItem('b', 'foto2.jpg'),
    ]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opciones de descarga'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Descargar individual a carpeta/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Elige la carpeta de destino/i)).toBeInTheDocument();
    });
    expect(mockApi.imageOptimizerSaveFiles).not.toHaveBeenCalled();
  });

  it('saves all files via backend when output folder is configured', async () => {
    const folder = 'C:\\Users\\test\\destino';
    mockApi.dialogFolder.mockResolvedValue({ paths: [], folder });
    mockApi.imageOptimizerSaveFiles.mockResolvedValue({
      saved_path: folder,
      saved_count: 2,
      skipped_count: 0,
      saved: [
        { filename: 'foto_001.jpg', path: `${folder}\\foto_001.jpg` },
        { filename: 'foto_002.jpg', path: `${folder}\\foto_002.jpg` },
      ],
      skipped: [],
    });

    await mountAndAddFiles([
      makeDownloadableItem('a', 'foto1.jpg'),
      makeDownloadableItem('b', 'foto2.jpg'),
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta de destino/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opciones de descarga'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Descargar individual a carpeta/i }));
    });

    await waitFor(() => {
      expect(mockApi.imageOptimizerSaveFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          output_folder: folder,
          files: expect.arrayContaining([
            expect.objectContaining({ filename: 'foto_001.jpg' }),
            expect.objectContaining({ filename: 'foto_002.jpg' }),
          ]),
        }),
      );
    });
    expect(mockApi.imageOptimizerSaveFiles).toHaveBeenCalledTimes(1);
  });
});
