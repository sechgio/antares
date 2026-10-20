export function boxCss(
  x: string,
  y: string,
  width: string,
  height: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { '--width': width, '--height': height, '--translate-x': x, '--translate-y': y, ...extra };
}
