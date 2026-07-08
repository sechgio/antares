import { describe, expect, it } from 'vitest';
import { ESPACIOS_COLORS, pickDefaultColor, resolveItemColor, toColorInputValue } from '../utils/colors';

describe('espacios colors', () => {
  it('cycles palette colors by index', () => {
    expect(pickDefaultColor(0)).toBe(ESPACIOS_COLORS[0]);
    expect(pickDefaultColor(ESPACIOS_COLORS.length)).toBe(ESPACIOS_COLORS[0]);
  });

  it('uses stored color when present', () => {
    expect(resolveItemColor('#ff0000', 1)).toBe('#ff0000');
    expect(resolveItemColor(null, 2)).toBe(pickDefaultColor(2));
  });

  it('normalizes hex for color inputs', () => {
    expect(toColorInputValue('#3B82F6')).toBe('#3b82f6');
    expect(toColorInputValue('#abc')).toBe('#aabbcc');
    expect(toColorInputValue(null)).toBe(ESPACIOS_COLORS[0].toLowerCase());
    expect(toColorInputValue('not-a-color')).toBe(ESPACIOS_COLORS[0].toLowerCase());
    expect(toColorInputValue('  #EF4444  ')).toBe('#ef4444');
  });
});
