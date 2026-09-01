import { describe, expect, it } from 'vitest';
import { ensurePdfJs } from './pdfjs';

describe('ensurePdfJs', () => {
  it('returns the cached PDF.js module after the first call', async () => {
    const first = await ensurePdfJs();
    const second = await ensurePdfJs();
    expect(second).toBe(first);
  });
});
