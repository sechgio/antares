import { describe, expect, it } from 'vitest';
import { matchesRecordId } from './utils';

describe('preview-panel matchesRecordId', () => {
  it('matches basename with optional [-_]\\d+ suffix (aligned with canvas excel)', () => {
    expect(matchesRecordId('ABC-1.jpg', 'ABC')).toBe(true);
    expect(matchesRecordId('ABC_2.png', 'ABC')).toBe(true);
    expect(matchesRecordId('XYZ-1.jpg', 'ABC')).toBe(false);
    expect(matchesRecordId('ABC', 'ABC')).toBe(true);
    expect(matchesRecordId('ABC-1', 'ABC')).toBe(true);
    expect(matchesRecordId('ABC.pdf', 123)).toBe(false);
    expect(matchesRecordId('123-1.webp', 123)).toBe(true);
  });
});
