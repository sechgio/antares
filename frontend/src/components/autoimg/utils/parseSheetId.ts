/** Extrae el ID de un Google Sheet desde URL o ID directo. */
export function parseSheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

export function isLikelySheetId(value: string): boolean {
  const id = parseSheetId(value);
  return id.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(id);
}