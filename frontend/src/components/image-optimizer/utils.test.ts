import { describe, expect, it } from 'vitest';
import { DEFAULT_BATCH_SETTINGS } from './presets';
import { BatchSettings, ImageItem } from './types';
import { buildDownloadNameMap, buildZipFilename, reorderImageItems } from './utils';

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

describe('image optimizer zip export', () => {
  it('keeps a single zip extension when the user includes it', () => {
    const settings: BatchSettings = {
      ...DEFAULT_BATCH_SETTINGS,
      export: {
        mode: 'zip',
        zipName: 'fotos_cliente.zip',
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
      },
    };

    expect(buildZipFilename(settings)).toBe('imagenes_optimizadas_cliente.zip');
  });
});
