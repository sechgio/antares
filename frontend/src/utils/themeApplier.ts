import defaultThemeJson from '../../../shared/default-theme.json';
import type { ThemeConfig } from '../types';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';

export const DEFAULT_THEME: ThemeConfig = defaultThemeJson as ThemeConfig;

export const CUSTOM_ACCENT_KEY = 'custom';
export const THEME_CSS_CACHE_KEY = 'hc_theme_css_cache';
export const THEME_ACTIVE_CACHE_KEY = 'hc_theme_active_cache';
export const THEME_MODE_CACHE_KEY = 'hc_theme_mode';
export const THEME_DENSITY_CACHE_KEY = 'hc_theme_density';

const DEFAULT_CONTRAST = 60;
export const DEFAULT_THEME_DENSITY: ThemeDensity = 'comfortable';
const DENSITY_SCALE: Record<ThemeDensity, string> = {
  compact: '0.88',
  comfortable: '1',
  spacious: '1.12',
};

export const ACCENTS = [
  { key: 'violet', color: '#3B82F6', hover: '#2563EB', light: '#93C5FD', dark: '#1E40AF' },
  { key: 'blue', color: '#475467', hover: '#344054', light: '#D0D5DD', dark: '#101828' },
  { key: 'teal', color: '#14B8A6', hover: '#0F766E', light: '#5EEAD4', dark: '#115E59' },
  { key: 'green', color: '#84CC16', hover: '#65A30D', light: '#BEF264', dark: '#365314' },
  { key: 'amber', color: '#F59E0B', hover: '#D97706', light: '#FCD34D', dark: '#92400E' },
  { key: 'rose', color: '#F43F5E', hover: '#E11D48', light: '#FDA4AF', dark: '#9F1239' },
  { key: 'indigo', color: '#6366F1', hover: '#4F46E5', light: '#A5B4FC', dark: '#3730A3' },
  { key: 'cyan', color: '#06B6D4', hover: '#0891B2', light: '#67E8F9', dark: '#0E7490' },
  { key: 'pink', color: '#EC4899', hover: '#DB2777', light: '#F9A8D4', dark: '#BE185D' },
  { key: 'emerald', color: '#10B981', hover: '#059669', light: '#6EE7B7', dark: '#047857' },
  { key: 'orange', color: '#F97316', hover: '#EA580C', light: '#FDBA74', dark: '#9A3412' },
  { key: 'red', color: '#EF4444', hover: '#DC2626', light: '#FCA5A5', dark: '#B91C1C' },
];

const LIGHT_THEME: Partial<ThemeConfig> = {
  bg: '#F6F7FB',
  bg_secondary: '#FFFFFF',
  fg: '#121826',
  fg_muted: '#667085',
  fg_secondary: '#475467',
  fg_tertiary: '#98A2B3',
  border: '#D9DEE8',
};

const CSS_VAR_MAP: Record<string, string[]> = {
  bg: ['--bg-base', '--mc-canvas'],
  bg_secondary: ['--bg-surface', '--bg-elevated', '--mc-lifted', '--mc-bone'],
  fg: ['--text-primary', '--mc-ink'],
  fg_muted: ['--text-secondary', '--text-muted', '--mc-charcoal', '--mc-slate', '--mc-graphite'],
  fg_secondary: ['--text-secondary-strong'],
  fg_tertiary: ['--text-tertiary'],
  accent: ['--accent-primary', '--accent-orange', '--border-active', '--mc-signal'],
  accent_light: ['--accent-primary-hover', '--accent-orange-hover', '--mc-signalLight'],
  accent_hover: ['--mc-clay'],
  border: ['--border-subtle', '--border-medium', '--mc-granite', '--mc-dust'],
  error: ['--accent-red', '--mc-red'],
  warning: ['--accent-yellow', '--mc-yellow'],
  success: ['--accent-green'],
  blue_hover: ['--accent-secondary', '--mc-linkBlue'],
};

function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function selectedAccent(key: string) {
  return ACCENTS.find((item) => item.key === key) || ACCENTS[0];
}

function isKnownAccentKey(value?: string) {
  return ACCENTS.some((item) => item.key === value);
}

function normalizeAccentKey(value?: string) {
  if (value === 'orange') return 'violet';
  if (value === CUSTOM_ACCENT_KEY) return CUSTOM_ACCENT_KEY;
  return isKnownAccentKey(value) ? value || 'violet' : CUSTOM_ACCENT_KEY;
}

export function accentKeyForTheme(theme: ThemeConfig, fallback = 'violet') {
  if (theme.accent_key === CUSTOM_ACCENT_KEY) return CUSTOM_ACCENT_KEY;
  if (theme.accent_key && isKnownAccentKey(theme.accent_key)) {
    return theme.accent_key;
  }
  const byColor = ACCENTS.find((item) => item.color.toLowerCase() === theme.accent?.toLowerCase());
  if (byColor?.key) return byColor.key;
  return theme.accent ? CUSTOM_ACCENT_KEY : normalizeAccentKey(fallback);
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a: string, b: string) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableTextFor(background: string, light = '#FFFFFF', dark = '#111827') {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

function readableSecondaryFor(background: string) {
  return readableTextFor(background, '#CBD5E1', '#475467');
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function shadeHex(hex: string, amount: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const shift = amount * 255;
  const next = [rgb.r + shift, rgb.g + shift, rgb.b + shift]
    .map((value) => clamp(value).toString(16).padStart(2, '0'))
    .join('');
  return `#${next}`;
}

export function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

function normalizeContrast(value?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONTRAST;
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

export function normalizeThemeDensity(value?: string): ThemeDensity {
  return value === 'compact' || value === 'spacious' ? value : DEFAULT_THEME_DENSITY;
}

function mixHexColors(from: string, to: string, amount: number) {
  const left = hexToRgb(from);
  const right = hexToRgb(to);
  if (!left || !right) return from;

  const weight = Math.max(0, Math.min(1, amount));
  return `#${[left.r, left.g, left.b]
    .map((channel, index) => clamp(channel + (([right.r, right.g, right.b][index] - channel) * weight)).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function applyContrastToColor(color: string, foreground: string, background: string, value: number) {
  if (value === DEFAULT_CONTRAST) return color;

  const target = value > DEFAULT_CONTRAST ? foreground : background;
  const amount = value > DEFAULT_CONTRAST
    ? (value - DEFAULT_CONTRAST) / (100 - DEFAULT_CONTRAST)
    : (DEFAULT_CONTRAST - value) / (DEFAULT_CONTRAST - 1);
  return mixHexColors(color, target, amount);
}

function isThemeConfig(value: unknown): value is ThemeConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ThemeConfig>;
  return typeof candidate.bg === 'string' && typeof candidate.fg === 'string' && typeof candidate.accent === 'string';
}

export function readCachedActiveTheme() {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(THEME_ACTIVE_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as unknown;
    return isThemeConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasCachedThemeCSS() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(localStorage.getItem(THEME_CSS_CACHE_KEY));
  } catch {
    return false;
  }
}

function ensureReadableTheme(theme: ThemeConfig): ThemeConfig {
  const background = theme.bg || '#0A0A0A';
  const isDarkBg = relativeLuminance(background) <= 0.55;
  const primary = contrastRatio(background, theme.fg || '#FFFFFF') >= 4.5
    ? theme.fg
    : readableTextFor(background, '#F8FAFC', '#111827');

  const mutedCandidate = theme.fg_muted || '#A0A0A0';
  const secondaryCandidate = theme.fg_secondary || mutedCandidate;
  const secondary =
    contrastRatio(background, mutedCandidate) >= 3
      ? mutedCandidate
      : isDarkBg && contrastRatio(background, secondaryCandidate) >= 3
        ? secondaryCandidate
        : readableSecondaryFor(background);

  return {
    ...theme,
    fg: primary,
    fg_muted: secondary,
    fg_secondary: contrastRatio(background, theme.fg_secondary || secondary) >= 3
      ? theme.fg_secondary || secondary
      : secondary,
  };
}

export function composeTheme(theme: ThemeConfig, mode: ThemeMode, accentKey: string): ThemeConfig {
  const useLight = mode === 'light' || (mode === 'system' && !systemPrefersDark());
  const accent = isKnownAccentKey(accentKey) ? selectedAccent(accentKey) : null;
  return ensureReadableTheme({
    ...theme,
    density: normalizeThemeDensity(theme.density),
    ...(useLight ? LIGHT_THEME : {}),
    mode,
    accent_key: accent?.key || CUSTOM_ACCENT_KEY,
    ...(accent
      ? {
          accent: accent.color,
          accent_light: accent.light,
          accent_hover: accent.hover,
          accent_dark: accent.dark,
          orange: accent.light,
        }
      : theme.accent_key === CUSTOM_ACCENT_KEY
        ? {
            accent_light: shadeHex(theme.accent, 0.35),
            accent_hover: shadeHex(theme.accent, -0.15),
            accent_dark: shadeHex(theme.accent, -0.35),
            orange: shadeHex(theme.accent, 0.35),
          }
        : {}),
  } as ThemeConfig);
}

export function applyThemeToCSS(theme: ThemeConfig, mode: ThemeMode, accentKey: string) {
  const nextTheme = composeTheme(theme, mode, accentKey);
  const root = document.documentElement;
  const isLightTheme = relativeLuminance(nextTheme.bg) > 0.55;
  const contrast = normalizeContrast(nextTheme.contrast);
  const density = normalizeThemeDensity(nextTheme.density);
  const elevated = nextTheme.bg_elevated || shadeHex(nextTheme.bg_secondary, isLightTheme ? -0.04 : 0.04);
  const input = nextTheme.bg_input || shadeHex(nextTheme.bg_secondary, isLightTheme ? -0.07 : 0.07);
  const mediumBorder = nextTheme.border_medium || shadeHex(nextTheme.border, isLightTheme ? -0.12 : 0.12);
  const interfaceFontSize = nextTheme.interface_font_size || '13';
  const codeFontSize = nextTheme.code_font_size || '12';
  const interfaceFont = nextTheme.interface_font || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const codeFont = nextTheme.code_font || 'ui-monospace, SFMono-Regular, Consolas, monospace';
  const secondaryText = applyContrastToColor(nextTheme.fg_muted, nextTheme.fg, nextTheme.bg, contrast);
  const strongText = applyContrastToColor(nextTheme.fg_secondary, nextTheme.fg, nextTheme.bg, contrast);
  const tertiaryText = applyContrastToColor(nextTheme.fg_tertiary, nextTheme.fg, nextTheme.bg, contrast);
  const cssCache: Record<string, string> = {};

  Object.entries(CSS_VAR_MAP).forEach(([key, cssVars]) => {
    const value = nextTheme[key];
    if (!value) return;
    cssVars.forEach((cssVar) => {
      root.style.setProperty(cssVar, value);
      cssCache[cssVar] = value;
    });
  });

  const extraVars: Record<string, string> = {
    '--bg-elevated': elevated,
    '--bg-input': input,
    '--border-medium': mediumBorder,
    '--mc-lifted': elevated,
    '--mc-ghost': elevated,
    '--text-secondary': secondaryText,
    '--text-secondary-strong': strongText,
    '--text-muted': secondaryText,
    '--text-tertiary': tertiaryText,
    '--mc-charcoal': secondaryText,
    '--mc-slate': secondaryText,
    '--mc-graphite': strongText,
    '--text-on-accent': readableTextFor(nextTheme.accent),
    '--text-on-danger': readableTextFor(nextTheme.error || '#EF4444'),
    '--accent-primary-glow': `${nextTheme.accent}33`,
    '--accent-orange-glow': `${nextTheme.accent}33`,
    '--scrollbar-thumb': `${nextTheme.fg_muted}55`,
    '--scrollbar-thumb-hover': `${nextTheme.fg_muted}88`,
    '--selection-bg': `${nextTheme.accent}55`,
    '--selection-fg': readableTextFor(nextTheme.accent),
    '--app-interface-font': interfaceFont,
    '--app-code-font': codeFont,
    '--app-font-size': `${interfaceFontSize}px`,
    '--app-code-font-size': `${codeFontSize}px`,
    '--app-contrast': String(contrast),
    '--app-density-scale': DENSITY_SCALE[density],
  };

  Object.entries(extraVars).forEach(([cssVar, value]) => {
    root.style.setProperty(cssVar, value);
    cssCache[cssVar] = value;
  });

  root.dataset.themeMode = mode;
  root.dataset.theme = isLightTheme ? 'light' : 'dark';
  root.classList.toggle('theme-light', isLightTheme);
  root.classList.toggle('theme-dark', !isLightTheme);
  root.dataset.pointerCursors = nextTheme.pointer_cursors || 'false';
  root.dataset.sidebarTranslucent = nextTheme.sidebar_translucent || 'false';
  root.dataset.themeDensity = density;

  try {
    localStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify(cssCache));
    localStorage.setItem(THEME_ACTIVE_CACHE_KEY, JSON.stringify(nextTheme));
    localStorage.setItem(THEME_MODE_CACHE_KEY, mode);
    localStorage.setItem(THEME_DENSITY_CACHE_KEY, density);
  } catch {}
}

export function restoreCachedTheme(): void {
  try {
    const cached = localStorage.getItem(THEME_CSS_CACHE_KEY);
    if (!cached) return;

    const themeVars = JSON.parse(cached) as Record<string, string>;
    Object.entries(themeVars).forEach(([name, value]) => {
      if (name.startsWith('--') && typeof value === 'string') {
        document.documentElement.style.setProperty(name, value);
      }
    });

    const mode = localStorage.getItem(THEME_MODE_CACHE_KEY);
    const density = localStorage.getItem(THEME_DENSITY_CACHE_KEY);
    if (mode) {
      document.documentElement.dataset.themeMode = mode;
      const isLightMode = mode === 'light' || (mode === 'system' && !systemPrefersDark());
      document.documentElement.dataset.theme = isLightMode ? 'light' : 'dark';
      document.documentElement.classList.toggle('theme-light', isLightMode);
      document.documentElement.classList.toggle('theme-dark', !isLightMode);
    }
    if (density) {
      const normalizedDensity = normalizeThemeDensity(density);
      document.documentElement.dataset.themeDensity = normalizedDensity;
      document.documentElement.style.setProperty('--app-density-scale', DENSITY_SCALE[normalizedDensity]);
    }

    const activeRaw = localStorage.getItem(THEME_ACTIVE_CACHE_KEY);
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as Record<string, unknown>;
      if (typeof active.pointer_cursors === 'string') {
        document.documentElement.dataset.pointerCursors = active.pointer_cursors;
      }
      if (typeof active.sidebar_translucent === 'string') {
        document.documentElement.dataset.sidebarTranslucent = active.sidebar_translucent;
      }
      if (typeof active.bg === 'string') {
        const isLightTheme = relativeLuminance(active.bg) > 0.55;
        document.documentElement.dataset.theme = isLightTheme ? 'light' : 'dark';
        document.documentElement.classList.toggle('theme-light', isLightTheme);
        document.documentElement.classList.toggle('theme-dark', !isLightTheme);
      }
      if (typeof active.density === 'string') {
        const normalizedDensity = normalizeThemeDensity(active.density);
        document.documentElement.dataset.themeDensity = normalizedDensity;
        document.documentElement.style.setProperty('--app-density-scale', DENSITY_SCALE[normalizedDensity]);
      }
    }
  } catch {}
}

function activeCacheSignature(): string | null {
  try {
    return localStorage.getItem(THEME_ACTIVE_CACHE_KEY);
  } catch {
    return null;
  }
}

export function bootThemeFromBackend(fetchTheme: () => Promise<ThemeConfig>): () => void {
  let cancelled = false;
  const cacheAtBoot = activeCacheSignature();
  fetchTheme()
    .then((theme) => {
      if (cancelled || !theme) return;
      if (activeCacheSignature() !== cacheAtBoot) return;
      const mode = (theme.mode as ThemeMode) || 'dark';
      applyThemeToCSS(theme, mode, accentKeyForTheme(theme));
    })
    .catch(() => {
      // IPC unavailable — the cached theme painted in main.tsx is the best we have.
    });
  return () => {
    cancelled = true;
  };
}
