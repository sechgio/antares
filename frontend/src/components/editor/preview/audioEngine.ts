import { type Clip, type ClipAudio } from '../types';

export interface AudioMixNode {
  clipId: string;
  gainDb: number;
  fadeInUs: number;
  fadeOutUs: number;
  durationUs: number;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function clipGain(audio: ClipAudio): number {
  const clamped = Math.max(-60, Math.min(24, audio.gainDb));
  return dbToGain(clamped);
}

export function fadeAt(audio: ClipAudio, offsetUs: number, durationUs: number): number {
  let factor = 1;
  if (audio.fadeInUs > 0 && offsetUs < audio.fadeInUs) {
    factor *= offsetUs / audio.fadeInUs;
  }
  const fadeOutStart = durationUs - audio.fadeOutUs;
  if (audio.fadeOutUs > 0 && offsetUs > fadeOutStart) {
    factor *= Math.max(0, (durationUs - offsetUs) / audio.fadeOutUs);
  }
  return Math.max(0, Math.min(1, factor));
}

export function mixLevels(nodes: AudioMixNode[]): { peak: number; rms: number } {
  if (nodes.length === 0) return { peak: 0, rms: 0 };
  let peak = 0;
  let sumSquares = 0;
  for (const node of nodes) {
    const level = Math.abs(dbToGain(node.gainDb));
    peak = Math.max(peak, level);
    sumSquares += level * level;
  }
  const rms = Math.sqrt(sumSquares / nodes.length);
  return { peak: Math.min(1, peak), rms: Math.min(1, rms) };
}

export function detectClipping(nodes: AudioMixNode[]): boolean {
  const total = nodes.reduce((acc, node) => acc + dbToGain(node.gainDb), 0);
  return total > 1.0;
}

export function workingMixFormat(channels: 1 | 2): { sampleRate: number; channels: 1 | 2 } {
  return { sampleRate: 48000, channels };
}

export function silenceForGap(gapUs: number): number {
  return Math.max(0, gapUs);
}

export function activeAudioClips(clips: Clip[]): Clip[] {
  return clips.filter(
    (clip) => (clip.kind === 'audio' || clip.kind === 'video') && clip.audio.embeddedEnabled,
  );
}
