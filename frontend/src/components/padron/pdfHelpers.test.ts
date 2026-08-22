import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clamp,
  chunkArray,
  clearImageBase64Cache,
  loadImageAsBase64,
  paginateLuriganchoItems,
  getRenderableExportSheets,
} from './pdfHelpers';
import type { PadronItem } from './data';

describe('pdfHelpers', () => {
  beforeEach(() => {
    clearImageBase64Cache();
  });

  afterEach(() => {
    clearImageBase64Cache();
    vi.restoreAllMocks();
  });

  describe('clamp', () => {
    it('clamps values within min and max', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
      expect(clamp(Number.NaN, 0, 10)).toBe(0);
    });
  });

  describe('chunkArray', () => {
    it('splits arrays into chunks of specified size', () => {
      expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunkArray([], 2)).toEqual([[]]);
    });
  });

  describe('paginateLuriganchoItems', () => {
    it('paginates landscape orientation with 18 items on first page', () => {
      const items: PadronItem[] = Array.from({ length: 50 }, (_, i) => ({
        item: i + 1,
        orden: i + 1,
        suministro: `SUM-${i}`,
        codigoCatastral: '',
        direccion: '',
        actividadComercial: '',
        firma: '',
        observaciones: '',
      }));
      const pages = paginateLuriganchoItems(items, 'landscape');
      expect(pages[0].length).toBe(18);
      expect(pages[1].length).toBe(31);
      expect(pages[2].length).toBe(1);
    });

    it('paginates portrait orientation with 37 items on first page', () => {
      const items: PadronItem[] = Array.from({ length: 60 }, (_, i) => ({
        item: i + 1,
        orden: i + 1,
        suministro: `SUM-${i}`,
        codigoCatastral: '',
        direccion: '',
        actividadComercial: '',
        firma: '',
        observaciones: '',
      }));
      const pages = paginateLuriganchoItems(items, 'portrait');
      expect(pages[0].length).toBe(37);
      expect(pages[1].length).toBe(23);
    });
  });

  describe('loadImageAsBase64', () => {
    it('returns data URLs directly without creating Image or Canvas', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await loadImageAsBase64(dataUrl);
      expect(result).toBe(dataUrl);
    });

    it('returns empty string immediately when url is empty', async () => {
      const result = await loadImageAsBase64('');
      expect(result).toBe('');
    });

    it('caches promise for repeated calls with same URL', async () => {
      const fakeUrl = 'https://example.com/logo.webp';
      const promise1 = loadImageAsBase64(fakeUrl);
      const promise2 = loadImageAsBase64(fakeUrl);
      expect(promise1).toBe(promise2);
    });

    it('clears cache when clearImageBase64Cache is called', () => {
      const fakeUrl = 'https://example.com/logo.webp';
      const p1 = loadImageAsBase64(fakeUrl);
      clearImageBase64Cache();
      const p2 = loadImageAsBase64(fakeUrl);
      expect(p1).not.toBe(p2);
    });
  });

  describe('getRenderableExportSheets', () => {
    it('returns sheets with positive offsetWidth', () => {
      const container = document.createElement('div');
      const sheet1 = document.createElement('div');
      sheet1.className = 'vpad-sheet';
      Object.defineProperty(sheet1, 'offsetWidth', { value: 800, configurable: true });

      const sheet2 = document.createElement('div');
      sheet2.className = 'vpad-sheet';
      Object.defineProperty(sheet2, 'offsetWidth', { value: 0, configurable: true });

      container.appendChild(sheet1);
      container.appendChild(sheet2);

      const renderable = getRenderableExportSheets(container);
      expect(renderable).toHaveLength(1);
      expect(renderable[0]).toBe(sheet1);
    });
  });
});
