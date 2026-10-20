import { clipDurationUs, clipEndUs, type Clip, type EditorProject } from '../types';

export type TimelineOperation =
  | { type: 'split'; clipId: string; atTimelineUs: number }
  | { type: 'trim'; clipId: string; sourceInUs?: number; sourceOutUs?: number }
  | { type: 'move'; clipId: string; timelineStartUs: number }
  | { type: 'duplicate'; clipId: string }
  | { type: 'repeat'; clipId: string; times: number }
  | { type: 'delete'; clipId: string };

interface OperationResult {
  clips: Clip[];
  changed: boolean;
}

function clone(clip: Clip): Clip {
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

function withClip(clips: Clip[], clipId: string, mutate: (clip: Clip) => void): Clip[] {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const next = clone(clip);
    mutate(next);
    return next;
  });
}

export function applyOperation(project: EditorProject, op: TimelineOperation): OperationResult {
  const clips = project.clips.map(clone);

  switch (op.type) {
    case 'split': {
      const source = clips.find((c) => c.id === op.clipId);
      if (!source) return { clips, changed: false };
      const start = source.timelineStartUs;
      const end = clipEndUs(source);
      if (op.atTimelineUs <= start || op.atTimelineUs >= end) {
        return { clips, changed: false };
      }
      const atSourceUs = timelineToSourceUs(source, op.atTimelineUs);
      const left = clone(source);
      left.sourceOutUs = atSourceUs;
      const right = clone(source);
      right.id = `${source.id}-b`;
      right.timelineStartUs = op.atTimelineUs;
      right.sourceInUs = atSourceUs;
      const index = clips.findIndex((c) => c.id === op.clipId);
      const next = [...clips];
      next.splice(index, 1, left, right);
      return { clips: next, changed: true };
    }

    case 'trim': {
      const source = clips.find((c) => c.id === op.clipId);
      if (!source) return { clips, changed: false };
      let changed = false;
      const next = withClip(clips, op.clipId, (clip) => {
        if (op.sourceInUs !== undefined) {
          const clamped = Math.max(0, Math.min(op.sourceInUs, clip.sourceOutUs - 1));
          if (clamped !== clip.sourceInUs) {
            clip.sourceInUs = clamped;
            changed = true;
          }
        }
        if (op.sourceOutUs !== undefined) {
          const clamped = Math.max(clip.sourceInUs + 1, Math.round(op.sourceOutUs));
          if (clamped !== clip.sourceOutUs) {
            clip.sourceOutUs = clamped;
            changed = true;
          }
        }
      });
      return { clips: next, changed };
    }

    case 'move': {
      const source = clips.find((c) => c.id === op.clipId);
      if (!source) return { clips, changed: false };
      const clamped = Math.max(0, Math.round(op.timelineStartUs));
      if (clamped === source.timelineStartUs) return { clips, changed: false };
      return {
        clips: withClip(clips, op.clipId, (clip) => {
          clip.timelineStartUs = clamped;
        }),
        changed: true,
      };
    }

    case 'duplicate': {
      const source = clips.find((c) => c.id === op.clipId);
      if (!source) return { clips, changed: false };
      const copy = clone(source);
      copy.id = `${source.id}-c`;
      copy.timelineStartUs = clipEndUs(source);
      return { clips: [...clips, copy], changed: true };
    }

    case 'repeat': {
      const source = clips.find((c) => c.id === op.clipId);
      if (!source) return { clips, changed: false };
      const times = Math.max(1, Math.min(Math.floor(op.times), 100));
      const duration = clipDurationUs(source);
      const copies: Clip[] = [];
      for (let i = 1; i <= times; i += 1) {
        const copy = clone(source);
        copy.id = `${source.id}-r${i}`;
        copy.timelineStartUs = source.timelineStartUs + i * duration;
        copies.push(copy);
      }
      return { clips: [...clips, ...copies], changed: copies.length > 0 };
    }

    case 'delete': {
      const exists = clips.some((c) => c.id === op.clipId);
      if (!exists) return { clips, changed: false };
      return { clips: clips.filter((c) => c.id !== op.clipId), changed: true };
    }

    default:
      return { clips, changed: false };
  }
}

export function timelineEndUs(clips: Clip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clipEndUs(clip)), 0);
}

export function clipsInTrack(clips: Clip[], trackId: string): Clip[] {
  return clips.filter((c) => c.trackId === trackId).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
}

export function clipAt(clips: Clip[], trackId: string, timelineUs: number): Clip | null {
  const found = clips.find(
    (c) => c.trackId === trackId && timelineUs >= c.timelineStartUs && timelineUs < clipEndUs(c),
  );
  return found ?? null;
}

function timelineToSourceUs(clip: Clip, timelineUs: number): number {
  const { num, den } = clip.speed;
  return clip.sourceInUs + Math.round(((timelineUs - clip.timelineStartUs) * num) / den);
}
