import { describe, expect, it } from 'vitest';
import { buildCacheKey } from './PdfPagePreview';
import { otherPagesCacheKey } from './previewRender';

describe('sellador preview cache keys', () => {
  it('separates PDF sources loaded in different revisions', () => {
    const first = buildCacheKey(null, 'AAAA', null, 1, 900, 1);
    const second = buildCacheKey(null, 'BBBB', null, 1, 900, 2);

    expect(first).not.toBe(second);
  });

  it('separates different File objects with identical metadata', () => {
    const firstFile = new File(['AAAA'], 'document.pdf', { lastModified: 1 });
    const secondFile = new File(['BBBB'], 'document.pdf', { lastModified: 1 });

    const first = buildCacheKey(null, null, firstFile, 1, 900, 0);
    const second = buildCacheKey(null, null, secondFile, 1, 900, 0);

    expect(first).not.toBe(second);
  });

  it('separates rendered pages when the stamp asset changes', () => {
    const first = otherPagesCacheKey(null, 'AAAA', null, 1, 2, 800, 'blob:stamp-a', []);
    const second = otherPagesCacheKey(null, 'AAAA', null, 1, 2, 800, 'blob:stamp-b', []);

    expect(first).not.toBe(second);
  });
});
