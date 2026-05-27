import { describe, expect, it } from 'vitest';
import { createStoredZipBlob } from './zip';

async function readStoredZipEntries(blob: Blob): Promise<Array<{ name: string; content: string }>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const entries: Array<{ name: string; content: string }> = [];
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + filenameLength)),
      content: decoder.decode(bytes.subarray(dataStart, dataEnd)),
    });
    offset = dataEnd;
  }

  return entries;
}

describe('image optimizer client zip export', () => {
  it('creates a valid local zip without base64 or backend IPC', async () => {
    const zip = await createStoredZipBlob(
      [
        { filename: 'C:/clientes/foto 1.jpg', blob: new Blob(['uno'], { type: 'image/jpeg' }) },
        { filename: '../logos/logo.png', blob: new Blob(['dos'], { type: 'image/png' }) },
      ],
      'imagenes optimizadas.zip',
    );

    const entries = await readStoredZipEntries(zip);

    expect(zip.type).toBe('application/zip');
    expect(entries).toEqual([
      { name: 'imagenes_optimizadas/foto 1.jpg', content: 'uno' },
      { name: 'imagenes_optimizadas/logo.png', content: 'dos' },
    ]);
  });

  it('deduplicates colliding archive basenames from different folders', async () => {
    const zip = await createStoredZipBlob(
      [
        { filename: 'C:/lote-a/foto.jpg', blob: new Blob(['uno'], { type: 'image/jpeg' }) },
        { filename: 'D:/lote-b/foto.jpg', blob: new Blob(['dos'], { type: 'image/jpeg' }) },
        { filename: 'foto.JPG', blob: new Blob(['tres'], { type: 'image/jpeg' }) },
      ],
      'fotos.zip',
    );

    const entries = await readStoredZipEntries(zip);

    expect(entries).toEqual([
      { name: 'fotos/foto.jpg', content: 'uno' },
      { name: 'fotos/foto-2.jpg', content: 'dos' },
      { name: 'fotos/foto-3.JPG', content: 'tres' },
    ]);
  });

  it('handles thousands of entries without materializing file buffers into a single base64 payload', async () => {
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      filename: `C:/lote/foto_${String(index).padStart(4, '0')}.jpg`,
      blob: new Blob([`img-${index}`], { type: 'image/jpeg' }),
    }));

    const zip = await createStoredZipBlob(entries, 'lote.zip');
    const storedEntries = await readStoredZipEntries(zip);

    expect(storedEntries).toHaveLength(1000);
    expect(storedEntries[0]).toEqual({ name: 'lote/foto_0000.jpg', content: 'img-0' });
    expect(storedEntries[999]).toEqual({ name: 'lote/foto_0999.jpg', content: 'img-999' });
  });
});
