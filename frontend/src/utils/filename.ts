export function safeFilenamePart(value: unknown, fallback = 'archivo'): string {
  const text = String(value ?? '').trim();
  return text.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || fallback;
}
