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

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

export function pickDefaultColor(index: number): string {
  return ESPACIOS_COLORS[index % ESPACIOS_COLORS.length];
}

export function toColorInputValue(color: string | null | undefined, fallback: string = ESPACIOS_COLORS[0]): string {
  if (!color) return fallback.toLowerCase();
  const trimmed = color.trim();
  if (HEX6.test(trimmed)) return trimmed.toLowerCase();
  const short = trimmed.match(HEX3);
  if (short) {
    const [r, g, b] = short[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback.toLowerCase();
}

export function resolveItemColor(color: string | null | undefined, fallbackIndex = 0): string {
  if (color) return toColorInputValue(color, pickDefaultColor(fallbackIndex));
  return pickDefaultColor(fallbackIndex);
}