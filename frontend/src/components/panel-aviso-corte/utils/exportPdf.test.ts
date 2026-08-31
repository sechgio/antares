import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildImagePayload } from './exportPdf';
import type { LocalImage } from '../types';

const image = (name: string): LocalImage => ({
  file: new File(['content'], name, { type: 'image/jpeg' }),
  objectUrl: `blob:${name}`,
});

function stubElectronStaging() {
  let sequence = 0;
  const api = {
    fileStagedCreate: vi.fn(async () => ({ token: 'antares-staged_test' })),
    fileStagedAppend: vi.fn(async () => ({ bytesWritten: 1 })),
    fileStagedComplete: vi.fn(async () => ({ file_token: `antares-read_${++sequence}` })),
  };
  vi.stubGlobal('window', { electronAPI: api });
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('panel aviso PDF export payload', () => {
  it('prefers staged files and skips Base64 when staging is available', async () => {
    const reader = vi.fn(async (file: File) => `b64:${file.name}`);
    stubElectronStaging();
    const payload = await buildImagePayload(
      new Map([
        ['disk.jpg', image('disk.jpg')],
        ['memory.jpg', image('memory.jpg')],
      ]),
      reader,
    );

    expect(payload).toEqual({
      imagePaths: { 'disk.jpg': 'antares-read_1', 'memory.jpg': 'antares-read_2' },
      imagesBase64: {},
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it('uses Base64 only when the Electron staging bridge is unavailable', async () => {
    const reader = vi.fn(async (file: File) => `b64:${file.name}`);
    vi.stubGlobal('window', { electronAPI: {} });
    const payload = await buildImagePayload(
      new Map([
        ['a.jpg', image('a.jpg')],
        ['b.jpg', image('b.jpg')],
      ]),
      reader,
    );

    expect(payload.imagePaths).toEqual({});
    expect(payload.imagesBase64).toEqual({ 'a.jpg': 'b64:a.jpg', 'b.jpg': 'b64:b.jpg' });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('keeps large disk-backed batches out of base64 payloads', async () => {
    const reader = vi.fn(async (file: File) => `b64:${file.name}`);
    stubElectronStaging();
    const images = new Map(
      Array.from({ length: 300 }, (_, index) => {
        const name = `img-${index + 1}.jpg`;
        return [name, image(name)];
      }),
    );

    const payload = await buildImagePayload(images, reader);

    expect(Object.keys(payload.imagePaths)).toHaveLength(300);
    expect(Object.values(payload.imagePaths).every((value) => value.startsWith('antares-read_'))).toBe(true);
    expect(payload.imagesBase64).toEqual({});
    expect(reader).not.toHaveBeenCalled();
  });
});
