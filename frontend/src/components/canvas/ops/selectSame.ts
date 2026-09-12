import type { CanvasLayer, LayerCssVars } from '../types';

export type SelectSameCriterion = 'fill' | 'stroke' | 'font';

const CRITERION_VAR: Record<SelectSameCriterion, keyof LayerCssVars> = {
  fill: '--background-color',
  stroke: '--border-color',
  font: '--font-family',
};

const FONT_TYPES = new Set(['text', 'field']);

export function selectSameApplicable(layer: CanvasLayer, criterion: SelectSameCriterion): boolean {
  if (criterion === 'font') return FONT_TYPES.has(layer.type);
  return layer.type !== 'frame';
}

export function sameLayerIds(
  layers: CanvasLayer[],
  ref: CanvasLayer | null,
  criterion: SelectSameCriterion,
): string[] {
  if (!ref || !selectSameApplicable(ref, criterion)) return [];
  const key = CRITERION_VAR[criterion];
  const value = ref.cssVars[key];
  if (value === undefined) return [];
  return layers
    .filter((l) => selectSameApplicable(l, criterion) && l.cssVars[key] === value)
    .map((l) => l.id);
}
