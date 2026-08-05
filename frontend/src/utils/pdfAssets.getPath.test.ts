import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalImageToken,
  fileToPdfImageSource,
  getElectronFilePath,
  imageToPdfSource,
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
