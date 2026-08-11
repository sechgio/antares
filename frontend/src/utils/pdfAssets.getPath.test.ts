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
