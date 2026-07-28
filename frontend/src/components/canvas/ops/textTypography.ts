/** Figma-like typography helpers: numeric inspector values ↔ cssVars. */

const FONT_SIZE_RE = /^(-?[\d.]+)\s*(pt|px)?$/i;
const LETTER_SPACING_RE = /^(-?[\d.]+)\s*(px|em)?$/i;

/** Parse `--font-size` to design pt (unitless / pt as-is; px → pt at 96dpi). */
export function parseFontSizePt(raw: string | undefined, fallback = 11): number {
  if (!raw?.trim()) return fallback;
  const m = FONT_SIZE_RE.exec(raw.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;
  const unit = (m[2] || 'pt').toLowerCase();
  if (unit === 'px') return Math.round(n * (72 / 96) * 100) / 100;
  return n;
}

export function formatFontSizePt(n: number): string {
  return `${Math.round(n * 100) / 100}pt`;
}

/** Parse `--letter-spacing` to px; unset → 0 (Figma default). */
export function parseLetterSpacingPx(raw: string | undefined): number {
  if (!raw?.trim()) return 0;
  const m = LETTER_SPACING_RE.exec(raw.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'em') return Math.round(n * 11 * 100) / 100; // approx vs default 11px
  return n;
}

export function formatLetterSpacingPx(n: number): string {
  if (Math.abs(n) < 1e-9) return '0px';
  return `${Math.round(n * 100) / 100}px`;
}

/** Parse line-height multiplier; unset → 1.2. */
export function parseLineHeight(raw: string | undefined, fallback = 1.2): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function formatLineHeight(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Bare numbers get a unit so CSS accepts the value (typing "14" alone is invalid).
 */
export function ensureCssUnit(raw: string, defaultUnit: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^-?[\d.]+$/.test(t)) return `${t}${defaultUnit}`;
  return t;
}

/**
 * Screen-constant chrome size under CSS camera zoom (Figma: handles don't grow/shrink).
 * Inside a `zoom: Z` frame, layout px of `screenPx / Z` paints as `screenPx` on screen.
 */
export function screenChromePx(screenPx: number, cameraZoom: number): number {
  const z = cameraZoom > 0 ? cameraZoom : 1;
  return screenPx / z;
}
