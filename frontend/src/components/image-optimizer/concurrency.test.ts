import { describe, expect, it, vi } from 'vitest';
import {
  mapWithConcurrencyLimit,
  resolveImportConcurrency,
  resolveProcessConcurrency,
} from './concurrency';
import { canUseProcessWorker } from './processWorkerClient';
import { processImageItem } from './pipeline';
import { DEFAULT_BATCH_SETTINGS } from './presets';
import { createImageOverrides } from './utils';
import type { ImageItem } from './types';

describe('mapWithConcurrencyLimit', () => {
  it('preserves order and respects concurrency', async () => {
    let active = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrencyLimit(items, 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('returns empty array for empty input', async () => {
    expect(await mapWithConcurrencyLimit([], 3, async (x) => x)).toEqual([]);
  });
});

describe('concurrency resolvers', () => {
  it('returns bounded import/process limits', () => {
    expect(resolveImportConcurrency()).toBeGreaterThanOrEqual(2);
    expect(resolveImportConcurrency()).toBeLessThanOrEqual(6);
    expect(resolveProcessConcurrency()).toBeGreaterThanOrEqual(1);
    expect(resolveProcessConcurrency()).toBeLessThanOrEqual(3);
  });
});

describe('process worker availability', () => {
  it('is false in jsdom (falls back to main thread)', () => {
    expect(canUseProcessWorker()).toBe(false);
  });
});

describe('processImageItem passthrough', () => {
  it('returns source directly when no ops enabled', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    const item: ImageItem = {
      id: '1',
      sourceFile: file,
      preview: 'blob:x',
      originalName: 'a.jpg',
      originalSize: 3,
      sourceWidth: 10,
      sourceHeight: 10,
      status: 'pending',
      stale: false,
      selected: false,
      excluded: false,
      overrides: createImageOverrides(),
    };
    const settings = {
      ...DEFAULT_BATCH_SETTINGS,
      operations: {
        cropEnabled: false,
        resizeEnabled: false,
        formatEnabled: false,
        compressionEnabled: false,
        renameEnabled: false,
      },
    };
    const artifact = await processImageItem(item, settings);
    expect(artifact.blob).toBe(file);
    expect(artifact.width).toBe(10);
    expect(artifact.height).toBe(10);
  });

  it('falls back to main path when worker unavailable and ops enabled', async () => {
    // In jsdom Image/canvas will fail; ensure we surface an Error rather than hanging.
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    const item: ImageItem = {
      id: '2',
      sourceFile: file,
      preview: 'blob:x',
      originalName: 'a.jpg',
      originalSize: 3,
      sourceWidth: 100,
      sourceHeight: 100,
      status: 'pending',
      stale: false,
      selected: false,
      excluded: false,
      overrides: createImageOverrides(),
    };
    const settings = {
      ...DEFAULT_BATCH_SETTINGS,
      operations: {
        ...DEFAULT_BATCH_SETTINGS.operations,
        resizeEnabled: true,
        compressionEnabled: false,
        cropEnabled: false,
        formatEnabled: false,
        renameEnabled: false,
      },
      resize: { maxWidth: 50, maxHeight: 50, noUpscale: true },
      compression: { ...DEFAULT_BATCH_SETTINGS.compression, useWebWorker: true },
    };

    // Stub Image so load fails quickly with our pipeline error
    const OriginalImage = globalThis.Image;
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);

    await expect(processImageItem(item, settings)).rejects.toThrow(/No se pudo cargar la imagen/);

    vi.stubGlobal('Image', OriginalImage);
  });
});
