import { afterEach, describe, expect, it, vi } from 'vitest';
import { getElectronFilePath } from './pdfAssets';

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
