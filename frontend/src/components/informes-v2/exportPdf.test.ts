import { afterEach, describe, expect, it, vi } from 'vitest';
import { photoToPdfPath } from './exportPdf';

describe('informes-v2 exportPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses local image tokens after staging the File for Electron', async () => {
    const file = new File(['x'], 'R-900-1.jpg', { type: 'image/jpeg' });
    let sequence = 0;
    vi.stubGlobal('window', {
      electronAPI: {
        fileStagedCreate: vi.fn(async () => ({ token: 'antares-staged_test' })),
        fileStagedAppend: vi.fn(async () => ({ bytesWritten: 1 })),
        fileStagedComplete: vi.fn(async () => ({ file_token: `antares-read_${++sequence}` })),
      },
    });
    const localImagePaths: Record<string, string> = {};
    const path = await photoToPdfPath(
      { name: 'R-900-1.jpg', src: 'data:image/jpeg;base64,xx', file },
      'photo-0',
      localImagePaths,
    );
    expect(path.startsWith('antares-local-image:')).toBe(true);
    expect(localImagePaths[path]).toBe('antares-read_1');
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
