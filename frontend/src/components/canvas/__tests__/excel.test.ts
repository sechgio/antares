import { describe, expect, it } from 'vitest';
import { buildImagesByRecordId } from '../runtime/excel';

describe('buildImagesByRecordId', () => {
  it('preserves exact and numbered image matches in natural order', () => {
    const images = [
      new File(['x'], 'A-10.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'A-1-2.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'A-2.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'A-1.jpg', { type: 'image/jpeg' }),
    ];

    const index = buildImagesByRecordId([{ ID: 'A' }, { ID: 'A-1' }], 'ID', images);

    expect(index.get('a')?.map((image) => image.name)).toEqual(['A-1.jpg', 'A-2.jpg', 'A-10.jpg']);
    expect(index.get('a-1')?.map((image) => image.name)).toEqual(['A-1-2.jpg', 'A-1.jpg']);
  });
});
