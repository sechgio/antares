import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIEW_PIXEL_WIDTH,
  MIN_PREVIEW_PIXEL_WIDTH,
  selladorPreviewDpr,
  selladorPreviewPixelWidth,
} from './previewDpi';

describe('selladorPreviewPixelWidth', () => {
  it('clamps selladorPreviewPixelWidth(400) to [MIN, MAX]', () => {
    const width = selladorPreviewPixelWidth(400);
    expect(width).toBeGreaterThanOrEqual(MIN_PREVIEW_PIXEL_WIDTH);
    expect(width).toBeLessThanOrEqual(MAX_PREVIEW_PIXEL_WIDTH);
  });

  it('never exceeds MAX for very large css width', () => {
    expect(selladorPreviewPixelWidth(50_000)).toBeLessThanOrEqual(MAX_PREVIEW_PIXEL_WIDTH);
    expect(selladorPreviewPixelWidth(50_000)).toBe(MAX_PREVIEW_PIXEL_WIDTH);
  });

  it('never goes below MIN for small css width', () => {
    expect(selladorPreviewPixelWidth(1)).toBeGreaterThanOrEqual(MIN_PREVIEW_PIXEL_WIDTH);
  });
});

describe('selladorPreviewDpr', () => {
  it('is finite and at most 3 (display cap)', () => {
    const dpr = selladorPreviewDpr();
    expect(Number.isFinite(dpr)).toBe(true);
    expect(dpr).toBeLessThanOrEqual(3);
    expect(dpr).toBeGreaterThan(0);
  });
});
