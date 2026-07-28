import { describe, expect, it } from 'vitest';
import {
  ensureCssUnit,
  formatFontSizePt,
  formatLetterSpacingPx,
  parseFontSizePt,
  parseLetterSpacingPx,
  parseLineHeight,
  screenChromePx,
} from '../ops/textTypography';

describe('textTypography (Figma-like inspector)', () => {
  it('parses font-size pt / px / bare number', () => {
    expect(parseFontSizePt('14pt')).toBe(14);
    expect(parseFontSizePt('14')).toBe(14);
    expect(parseFontSizePt('16px')).toBeCloseTo(12, 5); // 16 * 72/96
    expect(formatFontSizePt(11)).toBe('11pt');
  });

  it('ensureCssUnit adds default unit to bare numbers', () => {
    expect(ensureCssUnit('14', 'pt')).toBe('14pt');
    expect(ensureCssUnit('0.5', 'px')).toBe('0.5px');
    expect(ensureCssUnit('11pt', 'pt')).toBe('11pt');
    expect(ensureCssUnit('', 'pt')).toBe('');
  });

  it('parses letter-spacing and line-height', () => {
    expect(parseLetterSpacingPx(undefined)).toBe(0);
    expect(parseLetterSpacingPx('0.5px')).toBe(0.5);
    expect(formatLetterSpacingPx(0)).toBe('0px');
    expect(parseLineHeight(undefined)).toBe(1.2);
    expect(parseLineHeight('1.4')).toBe(1.4);
  });

  it('screen chrome stays constant under camera zoom', () => {
    expect(screenChromePx(8, 1)).toBe(8);
    expect(screenChromePx(8, 0.5)).toBe(16);
    expect(screenChromePx(10, 2)).toBe(5);
  });
});
