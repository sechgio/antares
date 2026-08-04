import { describe, expect, it, vi } from 'vitest';
import { photoToPdfPath } from './exportPdf';

describe('informes-v2 exportPdf', () => {
  it('uses local image tokens when Electron File.path is available', async () => {
    const file = new File(['x'], 'R-900-1.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: 'C:\\fotos\\R-900-1.jpg' });
    const localImagePaths: Record<string, string> = {};
    const path = await photoToPdfPath(
      { name: 'R-900-1.jpg', src: 'data:image/jpeg;base64,xx', file },
      'photo-0',
      localImagePaths,
    );
    expect(path.startsWith('antares-local-image:')).toBe(true);
    expect(localImagePaths[path]).toBe('C:\\fotos\\R-900-1.jpg');
  });

  it('rejects data-URL photos without a local File path', async () => {
    const localImagePaths: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no fetch')));
    await expect(
      photoToPdfPath(
        { name: 'R-900-1.jpg', src: 'data:image/png;base64,abc' },
        'photo-0',
        localImagePaths,
      ),
    ).rejects.toThrow(/ruta local|cargar las fotos/i);
    vi.unstubAllGlobals();
  });
});
