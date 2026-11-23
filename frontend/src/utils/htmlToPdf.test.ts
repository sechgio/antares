import { describe, expect, it, vi } from 'vitest';
import {
  a4PageSizeMm,
  a4TargetPixelWidth,
  canvasToJpegBytes,
  chunkExportItems,
  PDF_EXPORT_BATCH_SIZE,
  PX_PER_MM,
} from './htmlToPdf';

describe('htmlToPdf', () => {
  it('returns A4 sizes for both orientations', () => {
    expect(a4PageSizeMm('landscape')).toEqual({ widthMm: 297, heightMm: 210 });
    expect(a4PageSizeMm('portrait')).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('computes capture pixel width from mm and scale', () => {
    expect(a4TargetPixelWidth(297, 3)).toBe(Math.round(297 * PX_PER_MM * 3));
    expect(a4TargetPixelWidth(210, 2)).toBe(Math.round(210 * PX_PER_MM * 2));
  });

  it('batches export items and rejects invalid sizes', () => {
    const records = Array.from({ length: 25 }, (_, index) => ({ id: index }));
    const batches = chunkExportItems(records, PDF_EXPORT_BATCH_SIZE);
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(records);
    expect(() => chunkExportItems([1, 2, 3], 0)).toThrow('batch size');
  });

  it('encodes canvas pixels to JPEG bytes via toBlob', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const canvas = {
      toBlob: (cb: BlobCallback) => {
        cb(new Blob([bytes], { type: 'image/jpeg' }));
      },
    } as HTMLCanvasElement;

    const result = await canvasToJpegBytes(canvas, 0.92);
    expect(result).toEqual(bytes);
  });

  it('falls back to toDataURL when toBlob is missing', async () => {
    const canvas = {
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,AQID'),
    } as unknown as HTMLCanvasElement;

    const result = await canvasToJpegBytes(canvas, 0.8);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });
});
