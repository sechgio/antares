import type { Rational } from '../types';

export interface ZoomLevel {
  majorUs: number;
  minorUs: number;
  pxPerUs: number;
}

const MAJOR_TICK_PX = 100;
const MINOR_DIVISIONS = 5;
const SECOND_STEPS = [600, 300, 180, 120, 60, 30, 10, 5, 3, 2, 1];
const FRAME_STEPS = [15, 10, 5, 3, 2];

function frameUs(fps: Rational): number {
  return (1_000_000 * fps.den) / fps.num;
}

export function zoomLevels(fps: Rational): ZoomLevel[] {
  const frame = frameUs(fps);
  const majors = [
    ...SECOND_STEPS.map((s) => s * 1_000_000),
    ...FRAME_STEPS.map((f) => f * frame).filter((us) => us < 1_000_000),
  ];
  return majors.map((majorUs) => ({
    majorUs,
    minorUs: Math.max(frame, majorUs / MINOR_DIVISIONS),
    pxPerUs: MAJOR_TICK_PX / majorUs,
  }));
}

export function fitZoomIndex(levels: ZoomLevel[], durationUs: number, widthPx: number): number {
  if (durationUs <= 0 || widthPx <= 0) return Math.min(7, levels.length - 1);
  let best = 0;
  levels.forEach((level, index) => {
    if (durationUs * level.pxPerUs <= widthPx) best = index;
  });
  return best;
}

export function rulerTicks(
  level: ZoomLevel,
  startUs: number,
  endUs: number,
): Array<{ us: number; major: boolean }> {
  const ticks: Array<{ us: number; major: boolean }> = [];
  const perMajor = Math.max(1, Math.round(level.majorUs / level.minorUs));
  for (let i = Math.max(0, Math.floor(startUs / level.minorUs)); i * level.minorUs <= endUs; i += 1) {
    ticks.push({ us: Math.round(i * level.minorUs), major: i % perMajor === 0 });
  }
  return ticks;
}

export function snapToFrame(us: number, fps: Rational): number {
  const frame = frameUs(fps);
  return Math.max(0, Math.round(Math.round(us / frame) * frame));
}

export function formatTimecode(us: number, fps: Rational): string {
  const totalFrames = Math.round(us / frameUs(fps));
  const perSecond = Math.round(fps.num / fps.den);
  const frames = totalFrames % perSecond;
  const totalSeconds = Math.floor(totalFrames / perSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}
