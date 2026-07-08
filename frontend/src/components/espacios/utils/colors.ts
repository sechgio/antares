export const ESPACIOS_COLORS = [
  '#3B82F6',
  '#EF4444',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316',
  '#6366F1',
  '#14B8A6',
] as const;

export function pickDefaultColor(index: number): string {
  return ESPACIOS_COLORS[index % ESPACIOS_COLORS.length];
}

export function resolveItemColor(color: string | null | undefined, fallbackIndex = 0): string {
  return color ?? pickDefaultColor(fallbackIndex);
}