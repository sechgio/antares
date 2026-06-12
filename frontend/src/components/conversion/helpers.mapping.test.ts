import { describe, expect, it } from 'vitest';
import { computeMappingStats, findMappingCollisions, lookupMappingValue } from './helpers';

describe('mapping helpers', () => {
  it('computes matched, unmatched and orphan stats locally', () => {
    const mapping = {
      'IMG_0001.jpg': 'uno',
      'IMG_0002.jpg': 'dos',
      'IMG_0003.jpg': 'tres',
    };
    const stats = computeMappingStats(mapping, [
      'C:\\fotos\\IMG_0001.jpg',
      'C:\\fotos\\IMG_0002.jpg',
      'C:\\fotos\\missing.jpg',
    ]);

    expect(stats.matchedFiles).toBe(2);
    expect(stats.unmatchedFiles).toEqual(['missing.jpg']);
    expect(stats.orphanEntries).toEqual(['IMG_0003.jpg']);
    expect(stats.collisions).toEqual([]);
  });

  it('detects output name collisions', () => {
    const mapping = { 'A.jpg': 'mismo', 'B.jpg': 'mismo' };
    const collisions = findMappingCollisions(mapping, ['C:/tmp/A.jpg', 'C:/tmp/B.jpg']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].output).toBe('mismo.jpg');
    expect(collisions[0].sources).toEqual(['A.jpg', 'B.jpg']);
  });

  it('lookup is case insensitive', () => {
    expect(lookupMappingValue({ 'img_0001.jpg': 'fachada' }, 'IMG_0001.jpg')).toBe('fachada');
  });
});
