export const DEFAULT_LINE_STROKE_PX = 1;
export const STROKE_WEIGHT_MIN_PX = 0;
export const STROKE_WEIGHT_MAX_PX = 100;
export const STROKE_WEIGHT_STEP_PX = 0.1;

export function clampStrokeWeight(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LINE_STROKE_PX;
  return (
    Math.round(Math.min(STROKE_WEIGHT_MAX_PX, Math.max(STROKE_WEIGHT_MIN_PX, px)) * 100) / 100
  );
}

let lastStrokeWeightPx = DEFAULT_LINE_STROKE_PX;

/** Remember a positive stroke weight for subsequent line inserts. */
export function rememberStrokeWeight(px: number): void {
  const weight = clampStrokeWeight(px);
  if (weight > 0) lastStrokeWeightPx = weight;
}

/** Stroke weight to apply when placing a new line with the line tool. */
export function strokeWeightForNewLine(): number {
  return lastStrokeWeightPx > 0 ? lastStrokeWeightPx : DEFAULT_LINE_STROKE_PX;
}

/** Reset session last-used weight (tests / explicit restore). */
export function resetLastStrokeWeight(px = DEFAULT_LINE_STROKE_PX): void {
  lastStrokeWeightPx = clampStrokeWeight(px) || DEFAULT_LINE_STROKE_PX;
}
