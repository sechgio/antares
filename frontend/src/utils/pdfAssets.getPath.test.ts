import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalImageToken,
  fileToPdfImageSource,
  getElectronFilePath,
  imageToPdfSource,
  logoToPdfSource,
} from './pdfAssets';

describe('getElectronFilePath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers electronAPI.getPathForFile over deprecated File.path', () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: 'C:\\old\\a.jpg' });
    vi.stubGlobal('window', {
      electronAPI: {
        getPathForFile: vi.fn(() => 'C:\\new\\a.jpg'),
      },
    });
    expect(getElectronFilePath(file)).toBe('C:\\new\\a.jpg');
    expect(window.electronAPI?.getPathForFile).toHaveBeenCalledWith(file);
  });

  it('falls back to File.path when preload API is missing', () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: 'C:\\legacy\\a.jpg' });
    vi.stubGlobal('window', {});
    expect(getElectronFilePath(file)).toBe('C:\\legacy\\a.jpg');
  });
});

describe('pdf local-image allowlist', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emits a token when registerLocalPath succeeds', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: 'C:\\fotos\\a.jpg' });
    vi.stubGlobal('window', {
      electronAPI: {
        registerLocalPath: vi.fn(async () => ({ registered: true })),
      },
    });
    const localImagePaths: Record<string, string> = {};
    const src = await fileToPdfImageSource(file, 'photo-0', localImagePaths);
    expect(src).toBe(buildLocalImageToken('photo-0'));
    expect(localImagePaths[src]).toBe('C:\\fotos\\a.jpg');
  });

  it('falls back to compressed data URL when registerLocalPath fails', async () => {
    const file = new File(['fake-image-bytes'], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: 'C:\\fotos\\a.jpg' });
    vi.stubGlobal('window', {
      electronAPI: {
        registerLocalPath: vi.fn(async () => {
          throw new Error('not allowed');
        }),
      },
    });

    // jsdom Image may fail to decode; stub compress path via createObjectURL + Image.
    const objectUrl = 'blob:mock-a';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => objectUrl),
      revokeObjectURL: vi.fn(),
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 600;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => 'data:image/jpeg;base64,compressed',
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });

    const localImagePaths: Record<string, string> = {};
    const src = await fileToPdfImageSource(file, 'photo-0', localImagePaths);
    expect(src).toBe('data:image/jpeg;base64,compressed');
    expect(Object.keys(localImagePaths)).toHaveLength(0);

    const source = await imageToPdfSource(file, 'max', 'row-0');
    expect(source.src).toBe('data:image/jpeg;base64,compressed');
    expect(source.token).toBeUndefined();
  });
});

describe('fileToPdfImageSource staged upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubElectronStaging(fileToken = 'antares-read_1') {
    const api = {
      registerLocalPath: vi.fn(async () => {
        throw new Error('register_local_path is deprecated');
      }),
      fileStagedCreate: vi.fn(async () => ({ token: 'antares-staged_1' })),
      fileStagedAppend: vi.fn(async () => ({ bytesWritten: 1 })),
      fileStagedComplete: vi.fn(async () => ({ file_token: fileToken })),
    };
    vi.stubGlobal('window', { electronAPI: api });
    return api;
  }

  // jsdom no decodifica imágenes: simula la compresión por canvas.
  function stubCanvasCompression(dataUrl: string, w = 800, h = 600): void {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = w;
      naturalHeight = h;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => dataUrl,
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });
  }

  it('stages a pathless File (persisted panel photo) as a capability token', async () => {
    const api = stubElectronStaging();
    const file = new File(['image'], 'persistida.jpg', { type: 'image/jpeg' }); // sin path

    const localImagePaths: Record<string, string> = {};
    const src = await fileToPdfImageSource(file, 'photo-0', localImagePaths);

    expect(src).toBe(buildLocalImageToken('photo-0'));
    expect(localImagePaths[src]).toBe('antares-read_1');
    expect(api.fileStagedCreate).toHaveBeenCalledWith('persistida.jpg', 5);
    expect(api.fileStagedComplete).toHaveBeenCalledTimes(1);
  });

  it('stages each File object once even when referenced by several keys', async () => {
    const api = stubElectronStaging();
    const file = new File(['image'], 'compartida.jpg', { type: 'image/jpeg' });

    const localImagePaths: Record<string, string> = {};
    const srcA = await fileToPdfImageSource(file, 'panel-0-photo-0', localImagePaths);
    const srcB = await fileToPdfImageSource(file, 'panel-1-photo-0', localImagePaths);

    expect(srcA).not.toBe(srcB);
    expect(localImagePaths[srcA]).toBe('antares-read_1');
    expect(localImagePaths[srcB]).toBe('antares-read_1');
    expect(api.fileStagedCreate).toHaveBeenCalledTimes(1);
  });

  it('imageToPdfSource max stages the original file as a capability token', async () => {
    const api = stubElectronStaging();
    const file = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });

    const source = await imageToPdfSource(file, 'max', 'row-1-img-0');

    expect(source.src).toBe(buildLocalImageToken('row-1-img-0'));
    expect(source.token).toBe(source.src);
    expect(source.localPath).toBe('antares-read_1');
    expect(api.fileStagedCreate).toHaveBeenCalledWith('foto.jpg', 5);
  });

  it('imageToPdfSource high stages the compressed JPEG instead of inlining base64', async () => {
    const api = stubElectronStaging();
    const file = new File(['image'], 'foto.png', { type: 'image/png' });

    stubCanvasCompression('data:image/jpeg;base64,Y29tcHJlc3NlZA==', 4000, 3000);

    const source = await imageToPdfSource(file, 'high', 'row-1-img-0');

    expect(source.src).toBe(buildLocalImageToken('row-1-img-0'));
    expect(source.localPath).toBe('antares-read_1');
    // El archivo escenificado es el JPEG comprimido, no el original .png.
    expect(api.fileStagedCreate).toHaveBeenCalledWith('foto.jpg', expect.any(Number));
  });

  it('falls back to a data URL when the file extension is not stageable', async () => {
    const api = stubElectronStaging();
    const file = new File(['image'], 'foto.heic', { type: 'image/heic' });

    stubCanvasCompression('data:image/jpeg;base64,compressed');

    const localImagePaths: Record<string, string> = {};
    const src = await fileToPdfImageSource(file, 'photo-0', localImagePaths);

    expect(src).toBe('data:image/jpeg;base64,compressed');
    expect(Object.keys(localImagePaths)).toHaveLength(0);
    expect(api.fileStagedCreate).not.toHaveBeenCalled();
  });

  it('falls back to a data URL when staging rejects', async () => {
    const api = stubElectronStaging();
    api.fileStagedComplete.mockRejectedValue(new Error('staged session failed'));
    const file = new File(['image'], 'falla.jpg', { type: 'image/jpeg' });

    stubCanvasCompression('data:image/jpeg;base64,compressed');

    const localImagePaths: Record<string, string> = {};
    const src = await fileToPdfImageSource(file, 'photo-0', localImagePaths);

    expect(src).toBe('data:image/jpeg;base64,compressed');
    expect(Object.keys(localImagePaths)).toHaveLength(0);
  });
});

describe('logoToPdfSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function localLogoFile(path: string): File {
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: path });
    return file;
  }

  it('returns null when there is no logo URL', async () => {
    const localImagePaths: Record<string, string> = {};
    const src = await logoToPdfSource(null, null, 'logo-left', localImagePaths, true);
    expect(src).toBeNull();
    expect(Object.keys(localImagePaths)).toHaveLength(0);
  });

  it('emits antares-local-image token in RGB mode when the File path is allowlisted', async () => {
    const file = localLogoFile('C:\\logos\\izq.png');
    vi.stubGlobal('window', {
      electronAPI: {
        registerLocalPath: vi.fn(async () => ({ registered: true })),
      },
    });
    const localImagePaths: Record<string, string> = {};
    const src = await logoToPdfSource('blob:logo-left', file, 'logo-left', localImagePaths, true);
    expect(src).toBe(buildLocalImageToken('logo-left'));
    expect(localImagePaths[src]).toBe('C:\\logos\\izq.png');
  });

  it('keeps the durable URL (no token) in CMYK mode even with a local File', async () => {
    const file = localLogoFile('C:\\logos\\izq.png');
    vi.stubGlobal('window', {
      electronAPI: {
        registerLocalPath: vi.fn(async () => ({ registered: true })),
      },
    });
    const localImagePaths: Record<string, string> = {};
    // data: URL is already durable — returned unchanged, no token registered.
    const src = await logoToPdfSource('data:image/png;base64,AAAA', file, 'logo-left', localImagePaths, false);
    expect(src).toBe('data:image/png;base64,AAAA');
    expect(Object.keys(localImagePaths)).toHaveLength(0);
  });

  it('falls back to a durable URL when the File has no local path', async () => {
    const file = new File(['x'], 'logo.png', { type: 'image/png' }); // no path
    vi.stubGlobal('window', { electronAPI: { getPathForFile: vi.fn(() => '') } });
    const localImagePaths: Record<string, string> = {};
    const src = await logoToPdfSource('blob:logo-left', file, 'logo-left', localImagePaths, true);
    expect(src).toBe('blob:logo-left'); // fetch fails in jsdom → returns url unchanged
    expect(Object.keys(localImagePaths)).toHaveLength(0);
  });

  it('falls back to a durable URL when registerLocalPath rejects the path', async () => {
    const file = localLogoFile('C:\\denied\\logo.png');
    vi.stubGlobal('window', {
      electronAPI: {
        registerLocalPath: vi.fn(async () => {
          throw new Error('not allowed');
        }),
      },
    });
    const localImagePaths: Record<string, string> = {};
    const src = await logoToPdfSource('blob:logo-left', file, 'logo-left', localImagePaths, true);
    expect(src).toBe('blob:logo-left');
    expect(Object.keys(localImagePaths)).toHaveLength(0);
  });
});
