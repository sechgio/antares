/**
 * Session last-used stroke weight for new line inserts (Figma/Canva-like recall).
 *
 * Isolated into its own module so the hidden global state is discoverable and
 * independently testable, rather than buried in the 800-LOC layerStyle module.
 * `layerStyle.ts` re-exports these for back-comat with existing import sites.
 */

import { clampStrokeWeight, DEFAULT_LINE_STROKE_PX } from './layerStyle';

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
