import { describe, it, expect } from 'vitest';
import { applyOperation, clipAt, clipFromAsset, clipsInTrack, timelineEndUs, type TimelineOperation } from './operations';
import type { Clip, EditorProject, MediaAsset, Track } from '../types';

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 'track-v',
    kind: 'video',
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
    audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 0, fadeInUs: 0, fadeOutUs: 0, effects: [] },
    delogo: { rects: [] },
    effects: [],
    ...overrides,
  };
}

function project(clips: Clip[], tracks?: Track[]): EditorProject {
  return {
    id: 'p1',
    schemaVersion: 1,
    name: 'P',
    revision: 1,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    canvas: {
      width: 1280,
      height: 720,
      fps: { num: 25, den: 1 },
      background: { type: 'solid', color: '#000000' },
      workingColorSpace: 'bt709-sdr',
    },
    assets: [],
    tracks:
      tracks ??
      [{ id: 'track-v', kind: 'video', order: 0, visible: true, muted: false, locked: false }],
    clips,
    exportSettings: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 1280,
      height: 720,
      fps: { num: 25, den: 1 },
      qualityPreset: 'balanced',
      audioSampleRate: 48000,
      audioChannels: 2,
    },
  };
}

describe('operaciones de timeline', () => {
  it('divide conservando el límite compartido exacto', () => {
    const p = project([clip()]);
    const result = applyOperation(p, { type: 'split', clipId: 'c1', atTimelineUs: 2_000_000 });
    expect(result.changed).toBe(true);
    expect(result.clips).toHaveLength(2);
    const [left, right] = result.clips;
    expect(left.sourceOutUs).toBe(2_000_000);
    expect(right.sourceInUs).toBe(2_000_000);
    expect(right.timelineStartUs).toBe(2_000_000);
    expect(left.timelineStartUs + (left.sourceOutUs - left.sourceInUs) + (right.sourceOutUs - right.sourceInUs)).toBe(
      5_000_000,
    );
  });

  it('divide a velocidad distinta de 1 trasladando al tiempo fuente', () => {
    const slow = clip({ speed: { num: 1, den: 2 } });
    const p = project([slow]);
    const result = applyOperation(p, { type: 'split', clipId: 'c1', atTimelineUs: 4_000_000 });
    const [left, right] = result.clips;
    expect(left.sourceOutUs).toBe(2_000_000);
    expect(right.sourceInUs).toBe(2_000_000);
    expect(right.timelineStartUs).toBe(4_000_000);
  });

  it('rechaza dividir en los bordes', () => {
    const p = project([clip()]);
    expect(applyOperation(p, { type: 'split', clipId: 'c1', atTimelineUs: 0 }).changed).toBe(false);
    expect(applyOperation(p, { type: 'split', clipId: 'c1', atTimelineUs: 5_000_000 }).changed).toBe(false);
  });

  it('recorta sin cambiar la posición de timeline', () => {
    const p = project([clip({ timelineStartUs: 1_000_000 })]);
    const result = applyOperation(p, { type: 'trim', clipId: 'c1', sourceInUs: 1_000_000, sourceOutUs: 3_000_000 });
    expect(result.clips[0].timelineStartUs).toBe(1_000_000);
    expect(result.clips[0].sourceInUs).toBe(1_000_000);
    expect(result.clips[0].sourceOutUs).toBe(3_000_000);
  });

  it('recorta sin dejar intervalos degenerados', () => {
    const p = project([clip()]);
    const result = applyOperation(p, { type: 'trim', clipId: 'c1', sourceOutUs: 0 });
    expect(result.clips[0].sourceOutUs).toBeGreaterThan(result.clips[0].sourceInUs);
  });

  it('mueve sin admitir negativos', () => {
    const p = project([clip()]);
    const result = applyOperation(p, { type: 'move', clipId: 'c1', timelineStartUs: -500_000 });
    expect(result.clips[0].timelineStartUs).toBe(0);
  });

  it('duplica justo después del original', () => {
    const p = project([clip()]);
    const result = applyOperation(p, { type: 'duplicate', clipId: 'c1' });
    expect(result.clips).toHaveLength(2);
    expect(result.clips[1].id).not.toBe('c1');
    expect(result.clips[1].timelineStartUs).toBe(5_000_000);
  });

  it('repite un número finito de veces contiguas (copias adicionales)', () => {
    const p = project([clip({ sourceOutUs: 2_000_000 })]);
    const result = applyOperation(p, { type: 'repeat', clipId: 'c1', times: 3 });
    expect(result.clips).toHaveLength(4);
    const starts = result.clips.map((c) => c.timelineStartUs);
    expect(starts).toEqual([0, 2_000_000, 4_000_000, 6_000_000]);
  });

  it('limita las copias a 100', () => {
    const p = project([clip({ sourceOutUs: 100_000 })]);
    const result = applyOperation(p, { type: 'repeat', clipId: 'c1', times: 500 });
    expect(result.clips).toHaveLength(101); // original + 100 copias
  });

  it('borra el clip', () => {
    const p = project([clip(), clip({ id: 'c2', timelineStartUs: 5_000_000 })]);
    const result = applyOperation(p, { type: 'delete', clipId: 'c1' });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].id).toBe('c2');
  });

  it('operación sobre clip inexistente no cambia nada', () => {
    const p = project([clip()]);
    expect(applyOperation(p, { type: 'delete', clipId: 'x' }).changed).toBe(false);
    expect(applyOperation(p, { type: 'split', clipId: 'x', atTimelineUs: 1_000_000 }).changed).toBe(false);
  });

  it('no muta el documento original', () => {
    const p = project([clip()]);
    const before = JSON.stringify(p);
    applyOperation(p, { type: 'split', clipId: 'c1', atTimelineUs: 2_000_000 });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('consultas de timeline', () => {
  it('calcula el fin del timeline', () => {
    expect(timelineEndUs([clip(), clip({ id: 'c2', timelineStartUs: 3_000_000, sourceOutUs: 2_000_000 })])).toBe(
      5_000_000,
    );
    expect(timelineEndUs([])).toBe(0);
  });

  it('ordena clips de una pista por inicio', () => {
    const clips = [
      clip({ id: 'c2', timelineStartUs: 2_000_000 }),
      clip({ id: 'c1', timelineStartUs: 0 }),
    ];
    expect(clipsInTrack(clips, 'track-v').map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('encuentra el clip bajo el playhead (semiabierto)', () => {
    const clips = [clip({ timelineStartUs: 0, sourceOutUs: 2_000_000 })];
    expect(clipAt(clips, 'track-v', 0)?.id).toBe('c1');
    expect(clipAt(clips, 'track-v', 1_999_999)?.id).toBe('c1');
    expect(clipAt(clips, 'track-v', 2_000_000)).toBeNull();
    expect(clipAt(clips, 'otra-pista', 0)).toBeNull();
  });
});

describe('clipFromAsset', () => {
  const tracks: Track[] = [
    { id: 'track-a', kind: 'audio', order: 1, visible: true, muted: false, locked: false },
    { id: 'track-v', kind: 'video', order: 0, visible: true, muted: false, locked: false },
  ];
  function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
    return {
      id: 'a2',
      type: 'video',
      displayName: 'toma.mp4',
      byteSize: 10,
      sha256: 'a'.repeat(64),
      durationUs: 3_000_000,
      streams: [
        { index: 0, kind: 'video', codec: 'h264', timeBase: { num: 1, den: 25 } },
        { index: 1, kind: 'audio', codec: 'aac', timeBase: { num: 1, den: 48000 } },
      ],
      ...overrides,
    };
  }

  it('añade el video al final de la pista de video con su audio embebido', () => {
    const created = clipFromAsset(project([clip()], tracks), asset(), 'nuevo');
    expect(created).toMatchObject({
      id: 'nuevo',
      trackId: 'track-v',
      kind: 'video',
      assetId: 'a2',
      timelineStartUs: 5_000_000,
      sourceInUs: 0,
      sourceOutUs: 3_000_000,
      audio: { streamIndex: 1, embeddedEnabled: true },
    });
  });

  it('manda el audio a la pista de audio y da 5 s a las imágenes sin duración', () => {
    const p = project([], tracks);
    expect(clipFromAsset(p, asset({ type: 'audio' }), 'x')?.trackId).toBe('track-a');
    const image = clipFromAsset(p, asset({ type: 'image', durationUs: undefined, streams: [{ index: 0, kind: 'video', codec: 'png', timeBase: { num: 1, den: 25 } }] }), 'y');
    expect(image).toMatchObject({ kind: 'image', sourceOutUs: 5_000_000, audio: { embeddedEnabled: false } });
  });

  it('no añade nada si la pista destino está bloqueada', () => {
    const locked = tracks.map((t) => ({ ...t, locked: true }));
    expect(clipFromAsset(project([], locked), asset(), 'z')).toBeNull();
  });
});
