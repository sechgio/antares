import { describe, it, expect } from 'vitest';
import {
  activeAudioClips,
  clipGain,
  detectClipping,
  fadeAt,
  mixLevels,
  silenceForGap,
  workingMixFormat,
  type AudioMixNode,
} from './audioEngine';
import type { Clip } from '../types';

function audioClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId: 'track-a',
    kind: 'audio',
    assetId: 'a1',
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

describe('motor de audio de preview', () => {
  it('ganancia 0 dB es unitaria', () => {
    expect(clipGain(audioClip('c1').audio)).toBeCloseTo(1, 6);
  });

  it('ganancia -6 dB atenúa a la mitad', () => {
    expect(clipGain(audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: -6, fadeInUs: 0, fadeOutUs: 0, effects: [] } }).audio)).toBeCloseTo(0.5012, 3);
  });

  it('ganancia +6 dB amplifica', () => {
    expect(clipGain(audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 6, fadeInUs: 0, fadeOutUs: 0, effects: [] } }).audio)).toBeCloseTo(1.995, 2);
  });

  it('lima la ganancia al rango del contrato', () => {
    expect(clipGain(audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: -100, fadeInUs: 0, fadeOutUs: 0, effects: [] } }).audio)).toBeCloseTo(0.001, 4);
    expect(clipGain(audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 100, fadeInUs: 0, fadeOutUs: 0, effects: [] } }).audio)).toBeCloseTo(15.85, 1);
  });

  it('fade de entrada sube linealmente', () => {
    const audio = audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 0, fadeInUs: 1_000_000, fadeOutUs: 0, effects: [] } }).audio;
    expect(fadeAt(audio, 0, 5_000_000)).toBe(0);
    expect(fadeAt(audio, 500_000, 5_000_000)).toBeCloseTo(0.5, 6);
    expect(fadeAt(audio, 1_000_000, 5_000_000)).toBe(1);
  });

  it('fade de salida baja linealmente', () => {
    const audio = audioClip('c1', { audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 0, fadeInUs: 0, fadeOutUs: 1_000_000, effects: [] } }).audio;
    expect(fadeAt(audio, 5_000_000, 5_000_000)).toBe(0);
    expect(fadeAt(audio, 4_500_000, 5_000_000)).toBeCloseTo(0.5, 6);
    expect(fadeAt(audio, 4_000_000, 5_000_000)).toBe(1);
  });

  it('sin fades el factor es unitario', () => {
    const audio = audioClip('c1').audio;
    expect(fadeAt(audio, 2_000_000, 5_000_000)).toBe(1);
  });

  it('detecta clipping cuando la mezcla supera 0 dBFS', () => {
    const nodes: AudioMixNode[] = [
      { clipId: 'a', gainDb: 0, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
      { clipId: 'b', gainDb: 0, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
    ];
    expect(detectClipping(nodes)).toBe(true);
    expect(
      detectClipping([
        { clipId: 'a', gainDb: -12, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
        { clipId: 'b', gainDb: -12, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
      ]),
    ).toBe(false);
  });

  it('calcula niveles de mezcla acotados', () => {
    const levels = mixLevels([
      { clipId: 'a', gainDb: -6, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
      { clipId: 'b', gainDb: -3, fadeInUs: 0, fadeOutUs: 0, durationUs: 1 },
    ]);
    expect(levels.peak).toBeLessThanOrEqual(1);
    expect(levels.rms).toBeGreaterThan(0);
  });

  it('mezcla vacía no tiene nivel', () => {
    expect(mixLevels([])).toEqual({ peak: 0, rms: 0 });
  });

  it('formato de trabajo 48 kHz mono/estéreo', () => {
    expect(workingMixFormat(2)).toEqual({ sampleRate: 48000, channels: 2 });
    expect(workingMixFormat(1).channels).toBe(1);
  });

  it('huecos se rellenan con silencio sin negativos', () => {
    expect(silenceForGap(1_000_000)).toBe(1_000_000);
    expect(silenceForGap(-5)).toBe(0);
  });

  it('selecciona clips con audio activo', () => {
    const clips = [
      audioClip('a'),
      audioClip('b', { audio: { streamIndex: 0, embeddedEnabled: false, gainDb: 0, fadeInUs: 0, fadeOutUs: 0, effects: [] } }),
      audioClip('c', { kind: 'video' as never }),
    ];
    expect(activeAudioClips(clips).map((c) => c.id)).toEqual(['a', 'c']);
  });
});
