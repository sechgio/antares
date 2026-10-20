import { describe, it, expect } from 'vitest';
import { fitZoomIndex, formatTimecode, rulerTicks, snapToFrame, zoomLevels } from './scale';

const FPS = { num: 25, den: 1 };

describe('zoomLevels', () => {
  it('va de 10 min a 2 fotogramas por marca mayor, de menos a más zoom', () => {
    const levels = zoomLevels(FPS);
    expect(levels[0].majorUs).toBe(600_000_000);
    expect(levels[levels.length - 1].majorUs).toBe(80_000);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i].pxPerUs).toBeGreaterThan(levels[i - 1].pxPerUs);
    }
  });

  it('nunca divide las marcas menores por debajo de un fotograma', () => {
    for (const level of zoomLevels(FPS)) expect(level.minorUs).toBeGreaterThanOrEqual(40_000);
  });
});

describe('fitZoomIndex', () => {
  it('elige el mayor zoom en el que cabe toda la duración', () => {
    const levels = zoomLevels(FPS);
    const index = fitZoomIndex(levels, 60_000_000, 1000);
    expect(60_000_000 * levels[index].pxPerUs).toBeLessThanOrEqual(1000);
    expect(60_000_000 * levels[index + 1].pxPerUs).toBeGreaterThan(1000);
  });
});

describe('rulerTicks', () => {
  it('marca como mayor cada quinta marca dentro del rango visible', () => {
    const level = zoomLevels(FPS).find((l) => l.majorUs === 1_000_000)!;
    const ticks = rulerTicks(level, 0, 2_000_000);
    expect(ticks.filter((t) => t.major).map((t) => t.us)).toEqual([0, 1_000_000, 2_000_000]);
    expect(ticks).toHaveLength(11);
  });
});

describe('timecode', () => {
  it('ajusta al fotograma y formatea mm:ss:ff', () => {
    expect(snapToFrame(1_030_000, FPS)).toBe(1_040_000);
    expect(formatTimecode(61_080_000, FPS)).toBe('01:01:02');
  });
});
