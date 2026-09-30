import { describe, expect, it } from 'vitest';
import {
  clampMappingRect,
  hexToMappingColor,
  mappingColorCss,
  mappingColorToHex,
  mappingFontNameToCss,
  mappingFontWeight,
  mappingRectToOverlayStyle,
  mappingTextTopPercent,
  screenToMappingPoint,
} from './mappingCoords';

const PAGE = { width: 595, height: 842 };

describe('mappingCoords', () => {
  it('clamps rect inside page bounds with minimum size', () => {
    expect(clampMappingRect({ x: -10, y: -5, width: 5, height: 5 }, PAGE)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 12,
    });
  });

  it('converts screen coordinates to mapping points', () => {
    const imgEl = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 595,
        height: 842,
        right: 695,
        bottom: 892,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    };

    expect(screenToMappingPoint(397, 471, imgEl, PAGE)).toEqual({ x: 297, y: 421 });
  });

  it('maps rect to percentage overlay style', () => {
    expect(mappingRectToOverlayStyle({ x: 297.5, y: 42.1, width: 140, height: 20 }, PAGE)).toEqual({
      left: '50%',
      top: '5%',
      width: '23.52941176470588%',
      height: '2.375296912114014%',
    });
  });

  it('derives PDF-accurate font and text helpers', () => {
    expect(mappingFontNameToCss('Helvetica-Bold')).toContain('Helvetica');
    expect(mappingFontWeight('Courier-Bold')).toBe(700);
    expect(mappingColorCss(0.1176, 0.2275, 0.5412)).toBe('rgb(30, 58, 138)');
    expect(mappingTextTopPercent(25, 13, 842)).toBe('3.404513064133017%');
  });

  it('converts mapping colors to hex', () => {
    expect(mappingColorToHex(0, 0, 0)).toBe('#000000');
    expect(mappingColorToHex(0.1176, 0.2275, 0.5412)).toBe('#1e3a8a');
  });

  it('parses hex into normalized mapping colors', () => {
    expect(hexToMappingColor('#000000')).toEqual({ color_r: 0, color_g: 0, color_b: 0 });
    expect(hexToMappingColor('#1e3a8a')).toEqual({ color_r: 0.1176, color_g: 0.2275, color_b: 0.5412 });
    expect(hexToMappingColor('not-a-color')).toEqual({ color_r: 0, color_g: 0, color_b: 0 });
  });
});
