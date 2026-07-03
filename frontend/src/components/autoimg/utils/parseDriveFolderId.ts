export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes('/')) return trimmed;
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}