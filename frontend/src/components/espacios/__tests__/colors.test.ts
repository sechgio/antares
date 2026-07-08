import { describe, expect, it } from 'vitest';
import { ESPACIOS_COLORS, pickDefaultColor, resolveItemColor } from '../utils/colors';

describe('espacios colors', () => {
  it('cycles palette colors by index', () => {
    expect(pickDefaultColor(0)).toBe(ESPACIOS_COLORS[0]);
    expect(pickDefaultColor(ESPACIOS_COLORS.length)).toBe(ESPACIOS_COLORS[0]);
  });

  it('uses stored color when present', () => {
    expect(resolveItemColor('#ff0000', 1)).toBe('#ff0000');
    expect(resolveItemColor(null, 2)).toBe(pickDefaultColor(2));
  });
});