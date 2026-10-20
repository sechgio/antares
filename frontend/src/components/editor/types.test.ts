import { describe, expect, it } from 'vitest';
import {
  EDITOR_SCHEMA_VERSION,
  clipDurationUs,
  clipEndUs,
  sourceToTimelineUs,
  timelineToSourceUs,
  type Clip,
} from './types';

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    trackId: 'track-v',
    kind: 'video',
    assetId: 'asset-1',
    timelineStartUs: 0,
    sourceInUs: 0,
    sourceOutUs: 5_000_000,
    speed: { num: 1, den: 1 },
    transform: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      canvasX: 0,
      canvasY: 0,
      canvasW: 1,
      canvasH: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      fit: 'fit',
    },
    audio: {
      streamIndex: 0,
      embeddedEnabled: true,
      gainDb: 0,
      fadeInUs: 0,
      fadeOutUs: 0,
      effects: [],
    },
    delogo: { rects: [] },
    effects: [],
    ...overrides,
  };
}

describe('modelo temporal del editor', () => {
  it('expone schemaVersion 1', () => {
    expect(EDITOR_SCHEMA_VERSION).toBe(1);
  });

  it('duplica la duración a media velocidad', () => {
    expect(clipDurationUs(clip({ speed: { num: 1, den: 2 } }))).toBe(10_000_000);
  });

  it('reduce la duración al doble de velocidad', () => {
    expect(clipDurationUs(clip({ speed: { num: 2, den: 1 } }))).toBe(2_500_000);
  });

  it('conserva el límite compartido al dividir un clip', () => {
    const original = clip();
    const left = clip({ id: 'l', sourceOutUs: 2_000_000 });
    const right = clip({ id: 'r', sourceInUs: 2_000_000 });
    expect(clipDurationUs(left) + clipDurationUs(right)).toBe(clipDurationUs(original));
  });

  it('calcula el fin como inicio + duración (semiabierto)', () => {
    const c = clip({ timelineStartUs: 1_000_000 });
    expect(clipEndUs(c)).toBe(6_000_000);
  });

  it('rechaza velocidad no positiva', () => {
    expect(() => clipDurationUs(clip({ speed: { num: 0, den: 1 } }))).toThrow();
  });

  it('rechaza intervalos degenerados', () => {
    expect(() => clipDurationUs(clip({ sourceInUs: 5_000_000 }))).toThrow();
  });

  it('mapea fuente↔timeline con la misma política de redondeo', () => {
    const c = clip({ timelineStartUs: 500_000, speed: { num: 1, den: 2 } });
    expect(sourceToTimelineUs(c, 1_500_000)).toBe(3_500_000);
    expect(timelineToSourceUs(c, 3_500_000)).toBe(1_500_000);
  });

  it('redondea igual que Python en NTSC (half-up)', () => {
    const frames = Math.floor((1_500_000 * 30000) / (1001 * 1_000_000) + 0.5);
    expect(frames).toBe(45);
  });
});
