import { describe, expect, it, vi } from 'vitest';
import { buildImagePayload } from './exportPdf';
import type { LocalImage } from '../types';

const image = (name: string, localPath?: string): LocalImage => ({
  file: new File(['content'], name, { type: 'image/jpeg' }),
  objectUrl: `blob:${name}`,
  localPath,
});

describe('panel aviso PDF export payload', () => {
  it('prefers local paths and only base64-encodes fallback files', async () => {
    const reader = vi.fn(async (file: File) => `b64:${file.name}`);
    const payload = await buildImagePayload(
      new Map([
        ['disk.jpg', image('disk.jpg', 'C:\\fotos\\disk.jpg')],
        ['memory.jpg', image('memory.jpg')],
      ]),
      reader,
    );

    expect(payload).toEqual({
      imagePaths: { 'disk.jpg': 'C:\\fotos\\disk.jpg' },
      imagesBase64: { 'memory.jpg': 'b64:memory.jpg' },
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(expect.objectContaining({ name: 'memory.jpg' }));
  });

  it('keeps large disk-backed batches out of base64 payloads', async () => {
    const reader = vi.fn(async (file: File) => `b64:${file.name}`);
    const images = new Map(
      Array.from({ length: 300 }, (_, index) => {
        const name = `img-${index + 1}.jpg`;
        return [name, image(name, `C:\\fotos\\${name}`)];
      }),
    );

    const payload = await buildImagePayload(images, reader);

    expect(Object.keys(payload.imagePaths)).toHaveLength(300);
    expect(payload.imagesBase64).toEqual({});
    expect(reader).not.toHaveBeenCalled();
  });
});
