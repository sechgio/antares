import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BATCH_SETTINGS } from './presets';
import { BatchSettings, ImageItem } from './types';
import {
  arrayBufferToBase64,
  buildDownloadNameMap,
  buildExportNameMap,
  buildZipFilename,
  previewFilenames,
  resolveExportFilename,
  reorderImageItems,
  SAVE_CHUNK_SIZE,
  saveEntriesInChunks,
} from './utils';

function makeItem(id: string, originalName: string): ImageItem {
  return {
    id,
    originalName,
    sourceFile: new File(['x'], originalName, { type: 'image/jpeg' }),
    preview: '',
    originalSize: 1024,
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

const renameSettings: BatchSettings = {
  ...DEFAULT_BATCH_SETTINGS,
  operations: {
    ...DEFAULT_BATCH_SETTINGS.operations,
    renameEnabled: true,
  },
  rename: {
    prefix: 'foto',
    startAt: 1,
  },
};

describe('image optimizer queue order', () => {
  it('moves an image before the drop target without mutating the existing queue', () => {
    const items = [
      makeItem('first', 'a.jpg'),
      makeItem('second', 'b.jpg'),
      makeItem('third', 'c.jpg'),
    ];

    const reordered = reorderImageItems(items, 'third', 'first');

    expect(reordered.map((item) => item.id)).toEqual(['third', 'first', 'second']);
    expect(items.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('keeps before-target semantics when dragging an earlier image downward', () => {
    const items = [
      makeItem('first', 'a.jpg'),
      makeItem('second', 'b.jpg'),
      makeItem('third', 'c.jpg'),
    ];

    const reordered = reorderImageItems(items, 'first', 'third');

    expect(reordered.map((item) => item.id)).toEqual(['second', 'first', 'third']);
  });

  it('uses the reordered queue to assign sequential filenames', () => {
    const items = [
      makeItem('first', 'a.jpg'),
      makeItem('second', 'b.jpg'),
      makeItem('third', 'c.jpg'),
    ];

    const reordered = reorderImageItems(items, 'third', 'first');
    const names = buildDownloadNameMap(reordered, renameSettings);

    expect(names.get('third')).toBe('foto_001.jpg');
    expect(names.get('first')).toBe('foto_002.jpg');
    expect(names.get('second')).toBe('foto_003.jpg');
  });
});

describe('image optimizer export naming', () => {
  it('preserves queue indices when resolving names for a download subset', () => {
    const items = [
      makeItem('first', 'a.jpg'),
      makeItem('second', 'b.jpg'),
      makeItem('third', 'c.jpg'),
    ];
    const fullMap = buildExportNameMap(items, renameSettings);
    const subsetMap = buildDownloadNameMap([items[0], items[2]], renameSettings);

    expect(fullMap.get('first')).toBe('foto_001.jpg');
    expect(fullMap.get('third')).toBe('foto_003.jpg');
    expect(subsetMap.get('third')).toBe('foto_002.jpg');
    expect(resolveExportFilename('third', items, renameSettings)).toBe('foto_003.jpg');
  });

  it('previewFilenames shows sequential names when rename is enabled', () => {
    const names = previewFilenames(renameSettings, 0);
    expect(names[0]).toBe('foto_001.jpg');
    expect(names[1]).toBe('foto_002.jpg');
    expect(names[2]).toBe('foto_003.jpg');
  });
});

describe('image optimizer zip export', () => {
  it('keeps a single zip extension when the user includes it', () => {
    const settings: BatchSettings = {
      ...DEFAULT_BATCH_SETTINGS,
      export: {
        mode: 'zip',
        zipName: 'fotos_cliente.zip',
        outputFolder: '',
      },
    };

    expect(buildZipFilename(settings)).toBe('fotos_cliente.zip');
  });

  it('keeps the backend-compatible zip filename sanitization', () => {
    const settings: BatchSettings = {
      ...DEFAULT_BATCH_SETTINGS,
      export: {
        mode: 'zip',
        zipName: 'imagenes optimizadas cliente.zip',
        outputFolder: '',
      },
    };

    expect(buildZipFilename(settings)).toBe('imagenes_optimizadas_cliente.zip');
  });
});

describe('arrayBufferToBase64', () => {
  it('encodes an empty buffer to an empty string', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
  });

  it('encodes a small buffer identically to btoa', () => {
    const text = 'Antares optimizador';
    const buffer = new TextEncoder().encode(text).buffer;
    expect(arrayBufferToBase64(buffer)).toBe(btoa(text));
  });

  it('encodes a buffer larger than the chunk size without stack overflow', () => {
    const bytes = new Uint8Array(0x10000);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i & 0xff;
    }
    const encoded = arrayBufferToBase64(bytes.buffer);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.every((value, index) => value === bytes[index])).toBe(true);
  });
});

describe('saveEntriesInChunks', () => {
  function makeEntries(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      filename: `foto_${String(i + 1).padStart(3, '0')}.jpg`,
      blob: new Blob([`pixel-${i}`], { type: 'image/jpeg' }),
    }));
  }

  it(`splits IPC calls when the batch exceeds SAVE_CHUNK_SIZE (${SAVE_CHUNK_SIZE})`, async () => {
    const saveFiles = vi.fn(async ({ files }) => ({
      saved_count: files.length,
      skipped_count: 0,
    }));
    const progress: Array<[number, number]> = [];
    const total = SAVE_CHUNK_SIZE + 3;

    const result = await saveEntriesInChunks({
      entries: makeEntries(total),
      outputFolder: 'C:\\out',
      saveFiles,
      onProgress: (current, t) => progress.push([current, t]),
      encodeBuffer: () => 'YQ==',
    });

    expect(saveFiles).toHaveBeenCalledTimes(2);
    expect(saveFiles.mock.calls[0][0].files).toHaveLength(SAVE_CHUNK_SIZE);
    expect(saveFiles.mock.calls[1][0].files).toHaveLength(3);
    expect(result).toEqual({ saved_count: total, skipped_count: 0, cancelled: false });
    expect(progress.at(-1)).toEqual([total, total]);
  });

  it('aggregates saved and skipped counts across chunks', async () => {
    const saveFiles = vi
      .fn()
      .mockResolvedValueOnce({ saved_count: 2, skipped_count: 1 })
      .mockResolvedValueOnce({ saved_count: 1, skipped_count: 0 });

    const result = await saveEntriesInChunks({
      entries: makeEntries(3),
      outputFolder: '/tmp/out',
      chunkSize: 2,
      saveFiles,
      encodeBuffer: () => 'YQ==',
    });

    expect(result).toEqual({ saved_count: 3, skipped_count: 1, cancelled: false });
  });

  it('stops before the next IPC call when shouldCancel becomes true', async () => {
    let cancelAfterFirstChunk = false;
    const saveFiles = vi.fn(async ({ files }) => {
      cancelAfterFirstChunk = true;
      return { saved_count: files.length, skipped_count: 0 };
    });

    const result = await saveEntriesInChunks({
      entries: makeEntries(5),
      outputFolder: '/tmp/out',
      chunkSize: 2,
      saveFiles,
      shouldCancel: () => cancelAfterFirstChunk,
      encodeBuffer: () => 'YQ==',
    });

    expect(saveFiles).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(result.saved_count).toBe(2);
  });
});
