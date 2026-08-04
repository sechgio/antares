import { describe, expect, it } from 'vitest';
import { matchPhotosForId, matchesRecordId } from './photoMatch';

describe('informes-v2 photoMatch', () => {
  it('matchesRecordId accepts ID, ID-N and ID_N', () => {
    expect(matchesRecordId('R-900.jpg', 'R-900')).toBe(true);
    expect(matchesRecordId('R-900-1.jpg', 'R-900')).toBe(true);
    expect(matchesRecordId('R-900_2.png', 'R-900')).toBe(true);
    expect(matchesRecordId('R-901-1.jpg', 'R-900')).toBe(false);
  });

  it('matchesRecordId is case-insensitive and rejects empty id', () => {
    expect(matchesRecordId('r-900-1.JPG', 'R-900')).toBe(true);
    expect(matchesRecordId('R-900-1.jpg', '  ')).toBe(false);
    expect(matchesRecordId('R.900-1.jpg', 'R.900')).toBe(true);
  });

  it('matchPhotosForId sorts by suffix and caps at 6', () => {
    const photos = [
      { name: 'R-900-3.jpg', src: '3' },
      { name: 'R-900-1.jpg', src: '1' },
      { name: 'R-900-2.jpg', src: '2' },
      { name: 'R-900-4.jpg', src: '4' },
      { name: 'R-900-5.jpg', src: '5' },
      { name: 'R-900-6.jpg', src: '6' },
      { name: 'R-900-7.jpg', src: '7' },
      { name: 'other.jpg', src: 'x' },
    ];
    const matched = matchPhotosForId(photos, 'R-900');
    expect(matched.map((p) => p.name)).toEqual([
      'R-900-1.jpg',
      'R-900-2.jpg',
      'R-900-3.jpg',
      'R-900-4.jpg',
      'R-900-5.jpg',
      'R-900-6.jpg',
    ]);
  });

  it('matchPhotosForId returns empty for blank id and dedupes case variants', () => {
    expect(matchPhotosForId([{ name: 'R-900-1.jpg', src: '1' }], '   ')).toEqual([]);
    const matched = matchPhotosForId(
      [
        { name: 'R-900-1.jpg', src: 'a' },
        { name: 'R-900-1.JPG', src: 'b' },
      ],
      'R-900',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].src).toBe('a');
  });
});
