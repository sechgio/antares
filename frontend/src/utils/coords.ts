export type ParsedCoords = { lat: string; lon: string };

const COORD_PART = /^-?\d+(\.\d+)?$/;

/** True when value is a complete numeric coordinate string. */
export function isValidCoord(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && COORD_PART.test(trimmed);
}

/** Split "lat, lon" into two numeric strings, or null if not a valid pair. */
export function parseCombinedCoords(value: string): ParsedCoords | null {
  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return null;

  const latPart = value.slice(0, commaIndex).trim();
  const lonPart = value.slice(commaIndex + 1).trim();
  if (!latPart || !lonPart) return null;
  if (!COORD_PART.test(latPart) || !COORD_PART.test(lonPart)) return null;

  return { lat: latPart, lon: lonPart };
}
