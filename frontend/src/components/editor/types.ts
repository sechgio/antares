export const EDITOR_SCHEMA_VERSION = 1 as const;

type AssetType = 'video' | 'audio' | 'image' | 'animation';
type ClipKind = 'video' | 'audio' | 'image' | 'text';
type TrackKind = 'video' | 'audio';
type StreamKind = 'video' | 'audio';
type FitMode = 'fit' | 'fill';
type TextAlign = 'left' | 'center' | 'right';
type AnimationType = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'zoom';
type AudioEffectType = 'eq' | 'reverse' | 'denoise' | 'pitch';
type HeavyEffectType = 'vidstab' | 'chromakey' | 'pitch' | 'denoise' | 'reverse';
type BackgroundType = 'solid' | 'blur';
type QualityPreset = 'draft' | 'balanced' | 'high';
export type Container = 'mp4' | 'mkv' | 'mov' | 'webm';
type VideoCodec = 'h264' | 'vp9';
type AudioCodec = 'aac' | 'opus';

export interface Rational {
  num: number;
  den: number;
}

export interface CanvasBackground {
  type: BackgroundType;
  color?: string;
  blurStrength?: number;
}

export interface Canvas {
  width: number;
  height: number;
  fps: Rational;
  background: CanvasBackground;
  workingColorSpace: 'bt709-sdr';
}

export interface StreamInfo {
  index: number;
  kind: StreamKind;
  codec: string;
  width?: number;
  height?: number;
  sar?: Rational;
  rotation?: 0 | 90 | 180 | 270;
  orientation?: 'landscape' | 'portrait' | 'square';
  timeBase: Rational;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  sampleRate?: number;
  channels?: number;
}

export interface MediaAsset {
  id: string;
  type: AssetType;
  displayName: string;
  byteSize: number;
  sha256: string;
  durationUs?: number;
  streams: StreamInfo[];
}

export interface Track {
  id: string;
  kind: TrackKind;
  order: number;
  visible: boolean;
  muted: boolean;
  locked: boolean;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  crop: CropRect;
  canvasX: number;
  canvasY: number;
  canvasW: number;
  canvasH: number;
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  fit: FitMode;
}

export interface AudioEffect {
  type: AudioEffectType;
  bandGainDb?: number[];
  semitones?: number;
}

export interface ClipAudio {
  streamIndex: number;
  embeddedEnabled: boolean;
  gainDb: number;
  fadeInUs: number;
  fadeOutUs: number;
  effects: AudioEffect[];
}

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strokeWidthPx: number;
  strokeColor?: string;
  shadow?: boolean;
}

export interface AnimationPreset {
  type: AnimationType;
  durationUs: number;
}

export interface ClipText {
  content: string;
  fontId: string;
  fontSizePx: number;
  color: string;
  align: TextAlign;
  box: CropRect;
  style: TextStyle;
  entryPreset: AnimationPreset;
  exitPreset: AnimationPreset;
}

export interface DelogoRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Delogo {
  rects: DelogoRect[];
}

export interface HeavyEffect {
  type: HeavyEffectType;
  params: Record<string, unknown>;
  cacheRef: string;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  assetId?: string;
  timelineStartUs: number;
  sourceInUs: number;
  sourceOutUs: number;
  speed: Rational;
  transform: Transform;
  audio: ClipAudio;
  delogo: Delogo;
  text?: ClipText;
  effects: HeavyEffect[];
}

export interface ExportSettings {
  container: Container;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  width: number;
  height: number;
  fps: Rational;
  qualityPreset: QualityPreset;
  audioSampleRate: 44100 | 48000;
  audioChannels: 1 | 2;
}

export interface EditorProject {
  id: string;
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canvas: Canvas;
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  exportSettings: ExportSettings;
}

export function clipDurationUs(clip: Clip): number {
  const sourceUs = clip.sourceOutUs - clip.sourceInUs;
  const { num, den } = clip.speed;
  if (num <= 0 || den <= 0) throw new Error('speed.num y speed.den deben ser positivos');
  if (sourceUs <= 0) throw new Error('sourceOutUs debe ser mayor que sourceInUs');
  return Math.round((sourceUs * den) / num);
}

export function clipEndUs(clip: Clip): number {
  return clip.timelineStartUs + clipDurationUs(clip);
}

export function sourceToTimelineUs(clip: Clip, sourceUs: number): number {
  const { num, den } = clip.speed;
  return clip.timelineStartUs + Math.round(((sourceUs - clip.sourceInUs) * den) / num);
}

export function timelineToSourceUs(clip: Clip, timelineUs: number): number {
  const { num, den } = clip.speed;
  return clip.sourceInUs + Math.round(((timelineUs - clip.timelineStartUs) * num) / den);
}
