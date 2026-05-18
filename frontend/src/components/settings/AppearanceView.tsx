import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Copy,
  Laptop,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  Sun,
  Type,
  Upload,
} from 'lucide-react';
import { api } from '../../api';
import { ThemeConfig } from '../../types';
import Toggle from '../ui/Toggle';
import { useToast } from '../../hooks/useToast';

type ThemeMode = 'dark' | 'light' | 'system';

type EditableColor = {
  key: keyof ThemeConfig;
  label: string;
};

type ModeOption = {
  key: ThemeMode;
  label: string;
  icon: typeof Moon;
};

const CUSTOM_ACCENT_KEY = 'custom';
const THEME_CSS_CACHE_KEY = 'hc_theme_css_cache';
const THEME_ACTIVE_CACHE_KEY = 'hc_theme_active_cache';
const THEME_MODE_CACHE_KEY = 'hc_theme_mode';
const THEME_DENSITY_CACHE_KEY = 'hc_theme_density';

const ACCENTS = [
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

const MODE_OPTIONS: ModeOption[] = [
  { key: 'light', label: 'Claro', icon: Sun },
  { key: 'dark', label: 'Oscuro', icon: Moon },
  { key: 'system', label: 'Sistema', icon: Monitor },
];

const EDITABLE_COLORS: EditableColor[] = [
  { key: 'accent', label: 'Acento' },
  { key: 'bg', label: 'Fondo' },
  { key: 'fg', label: 'Color de primer plano' },
];

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

function accentKeyForTheme(theme: ThemeConfig, fallback = 'violet') {
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

function shadeHex(hex: string, amount: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const shift = amount * 255;
  const next = [rgb.r + shift, rgb.g + shift, rgb.b + shift]
    .map((value) => clamp(value).toString(16).padStart(2, '0'))
    .join('');
  return `#${next}`;
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

function isThemeConfig(value: unknown): value is ThemeConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ThemeConfig>;
  return typeof candidate.bg === 'string' && typeof candidate.fg === 'string' && typeof candidate.accent === 'string';
}

function readCachedActiveTheme() {
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

function hasCachedThemeCSS() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(localStorage.getItem(THEME_CSS_CACHE_KEY));
  } catch {
    return false;
  }
}

function ensureReadableTheme(theme: ThemeConfig): ThemeConfig {
  const background = theme.bg || '#0A0A0A';
  const primary = contrastRatio(background, theme.fg || '#FFFFFF') >= 4.5
    ? theme.fg
    : readableTextFor(background, '#F8FAFC', '#111827');
  const secondary = contrastRatio(background, theme.fg_muted || '#A0A0A0') >= 4.5
    ? theme.fg_muted
    : readableSecondaryFor(background);

  return {
    ...theme,
    fg: primary,
    fg_muted: secondary,
    fg_secondary: contrastRatio(background, theme.fg_secondary || secondary) >= 4.5
      ? theme.fg_secondary
      : secondary,
  };
}

function composeTheme(theme: ThemeConfig, mode: ThemeMode, accentKey: string): ThemeConfig {
  const useLight = mode === 'light' || (mode === 'system' && !systemPrefersDark());
  const accent = isKnownAccentKey(accentKey) ? selectedAccent(accentKey) : null;
  return ensureReadableTheme({
    ...theme,
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

function applyThemeToCSS(theme: ThemeConfig, mode: ThemeMode, accentKey: string) {
  const nextTheme = composeTheme(theme, mode, accentKey);
  const root = document.documentElement;
  const isLightTheme = relativeLuminance(nextTheme.bg) > 0.55;
  const elevated = nextTheme.bg_elevated || shadeHex(nextTheme.bg_secondary, isLightTheme ? -0.04 : 0.04);
  const input = nextTheme.bg_input || shadeHex(nextTheme.bg_secondary, isLightTheme ? -0.07 : 0.07);
  const mediumBorder = nextTheme.border_medium || shadeHex(nextTheme.border, isLightTheme ? -0.12 : 0.12);
  const interfaceFontSize = nextTheme.interface_font_size || '13';
  const codeFontSize = nextTheme.code_font_size || '12';
  const interfaceFont = nextTheme.interface_font || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const codeFont = nextTheme.code_font || 'ui-monospace, SFMono-Regular, Consolas, monospace';
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
    '--text-secondary-strong': nextTheme.fg_secondary || nextTheme.fg_muted,
    '--text-muted': nextTheme.fg_muted,
    '--text-tertiary': nextTheme.fg_tertiary || nextTheme.fg_muted,
    '--text-on-accent': readableTextFor(nextTheme.accent),
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
  };

  Object.entries(extraVars).forEach(([cssVar, value]) => {
    root.style.setProperty(cssVar, value);
    cssCache[cssVar] = value;
  });

  root.dataset.themeMode = mode;
  root.dataset.pointerCursors = nextTheme.pointer_cursors || 'false';
  root.dataset.sidebarTranslucent = nextTheme.sidebar_translucent || 'false';

  try {
    localStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify(cssCache));
    localStorage.setItem(THEME_ACTIVE_CACHE_KEY, JSON.stringify(nextTheme));
    localStorage.setItem(THEME_MODE_CACHE_KEY, mode);
    localStorage.setItem(THEME_DENSITY_CACHE_KEY, document.documentElement.dataset.themeDensity || nextTheme.density || 'comfortable');
  } catch {}
}

function displayPresetName(name?: string) {
  return name === 'Precision Linear' || !name ? 'Codex' : name;
}

function toStoredBool(value?: string, fallback = false) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[40px] grid-cols-[minmax(0,1fr)_minmax(120px,190px)] items-center gap-4 border-t border-[var(--border-subtle)] px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_136px]">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold leading-4 text-[var(--text-primary)]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">{hint}</div>}
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

export default function AppearanceView() {
  const { t, i18n } = useTranslation();
  const { addToast } = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<ThemeConfig | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [accent, setAccent] = useState(CUSTOM_ACCENT_KEY);
  const [language, setLanguage] = useState(i18n.language || 'es');
  const [presetOpen, setPresetOpen] = useState(false);
  const [pointerCursors, setPointerCursors] = useState(false);
  const [sidebarTranslucent, setSidebarTranslucent] = useState(false);
  const [contrast, setContrast] = useState(60);
  const [interfaceFontSize, setInterfaceFontSize] = useState(13);
  const [codeFontSize, setCodeFontSize] = useState(12);

  useEffect(() => { setLanguage(i18n.language); }, [i18n.language]);

  const refresh = useCallback(async () => {
    const backendTheme = await api.getTheme();
    const cachedTheme = readCachedActiveTheme();
    const initialTheme = cachedTheme || backendTheme;
    const nextMode = (initialTheme?.mode as ThemeMode) || 'dark';
    const nextAccent = accentKeyForTheme(initialTheme);
    const nextLanguage = initialTheme?.language || i18n.language || 'es';

    setTheme(initialTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setLanguage(nextLanguage);
    setPointerCursors(toStoredBool(initialTheme.pointer_cursors));
    setSidebarTranslucent(toStoredBool(initialTheme.sidebar_translucent));
    setContrast(Number(initialTheme.contrast || 60));
    setInterfaceFontSize(Number(initialTheme.interface_font_size || 13));
    setCodeFontSize(Number(initialTheme.code_font_size || 12));

    if (cachedTheme || !hasCachedThemeCSS()) {
      applyThemeToCSS(initialTheme, nextMode, nextAccent);
    }

    const presetResponse = await api.getPresets();
    setPresets(presetResponse.presets);
  }, [i18n.language]);

  useEffect(() => { refresh(); }, [refresh]);

  const visibleTheme = useMemo(() => {
    if (!theme) return null;
    return composeTheme(theme, mode, accent);
  }, [theme, mode, accent]);

  const patchTheme = (patch: Partial<ThemeConfig>) => {
    if (!theme) return;
    const nextTheme = { ...theme, ...patch } as ThemeConfig;
    setTheme(nextTheme);
    applyThemeToCSS(nextTheme, mode, patch.accent_key || accent);
  };

  const updateMode = (value: ThemeMode) => {
    setMode(value);
    if (theme) applyThemeToCSS(theme, value, accent);
  };

  const updateThemeColor = (key: keyof ThemeConfig, value: string) => {
    const normalized = normalizeHexColor(value);
    if (!theme || !normalized) return;
    const nextAccent = key === 'accent' ? CUSTOM_ACCENT_KEY : accent;
    const nextTheme = {
      ...theme,
      [key]: normalized,
      ...(key === 'accent'
        ? {
            accent_key: CUSTOM_ACCENT_KEY,
            orange: normalized,
            accent_light: shadeHex(normalized, 0.35),
            accent_hover: shadeHex(normalized, -0.15),
            accent_dark: shadeHex(normalized, -0.35),
          }
        : {}),
    } as ThemeConfig;
    setTheme(nextTheme);
    setAccent(nextAccent);
    applyThemeToCSS(nextTheme, mode, nextAccent);
  };

  const updateBool = (key: 'pointer_cursors' | 'sidebar_translucent', value: boolean) => {
    if (key === 'pointer_cursors') setPointerCursors(value);
    if (key === 'sidebar_translucent') setSidebarTranslucent(value);
    patchTheme({ [key]: String(value) } as Partial<ThemeConfig>);
  };

  const updateNumber = (key: 'contrast' | 'interface_font_size' | 'code_font_size', value: number) => {
    const normalized = Number.isFinite(value) ? value : 0;
    if (key === 'contrast') setContrast(normalized);
    if (key === 'interface_font_size') setInterfaceFontSize(normalized);
    if (key === 'code_font_size') setCodeFontSize(normalized);
    patchTheme({ [key]: String(normalized) } as Partial<ThemeConfig>);
  };

  const buildThemePayload = (): ThemeConfig => {
    const base = theme || ({} as ThemeConfig);
    return {
      ...composeTheme(base, mode, accent),
      language,
      pointer_cursors: String(pointerCursors),
      sidebar_translucent: String(sidebarTranslucent),
      contrast: String(contrast),
      interface_font_size: String(interfaceFontSize),
      code_font_size: String(codeFontSize),
      interface_font: base.interface_font || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      code_font: base.code_font || 'ui-monospace, SFMono-Regular, Consolas, monospace',
    };
  };

  const save = async () => {
    const payload = buildThemePayload();
    const savedTheme = await api.saveTheme(payload);
    setTheme(savedTheme);
    applyThemeToCSS(savedTheme, mode, accent);
    if (language !== i18n.language) {
      i18n.changeLanguage(language);
    }
    addToast({ message: t('appearance.savedAlert') || 'Tema guardado', type: 'success' });
  };

  const reset = async () => {
    const resetTheme = await api.resetTheme();
    const nextMode = (resetTheme?.mode as ThemeMode) || 'dark';
    const nextAccent = accentKeyForTheme(resetTheme);
    const nextLanguage = resetTheme?.language || 'es';

    setTheme(resetTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setLanguage(nextLanguage);
    setPointerCursors(toStoredBool(resetTheme.pointer_cursors));
    setSidebarTranslucent(toStoredBool(resetTheme.sidebar_translucent));
    setContrast(Number(resetTheme.contrast || 60));
    setInterfaceFontSize(Number(resetTheme.interface_font_size || 13));
    setCodeFontSize(Number(resetTheme.code_font_size || 12));
    applyThemeToCSS(resetTheme, nextMode, nextAccent);

    if (nextLanguage !== i18n.language) {
      i18n.changeLanguage(nextLanguage);
    }
    addToast({ message: t('appearance.resetAlert') || 'Tema restaurado', type: 'success' });
  };

  const applyPreset = async (name: string) => {
    const presetTheme = await api.applyPreset(name);
    const nextMode = (presetTheme?.mode as ThemeMode) || mode;
    const nextAccent = accentKeyForTheme(presetTheme, accent);
    const nextLanguage = presetTheme?.language || language;

    setTheme(presetTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setLanguage(nextLanguage);
    setPresetOpen(false);
    setPointerCursors(toStoredBool(presetTheme.pointer_cursors, pointerCursors));
    setSidebarTranslucent(toStoredBool(presetTheme.sidebar_translucent, sidebarTranslucent));
    setContrast(Number(presetTheme.contrast || contrast));
    setInterfaceFontSize(Number(presetTheme.interface_font_size || interfaceFontSize));
    setCodeFontSize(Number(presetTheme.code_font_size || codeFontSize));
    applyThemeToCSS(presetTheme, nextMode, nextAccent);
    addToast({ message: `Estilo "${displayPresetName(name)}" aplicado`, type: 'success' });
  };

  const applyImportedTheme = (importedTheme: ThemeConfig) => {
    const nextMode = (importedTheme?.mode as ThemeMode) || mode;
    const nextAccent = accentKeyForTheme(importedTheme, accent);
    const nextLanguage = importedTheme?.language || language;
    const nextPointerCursors = toStoredBool(importedTheme.pointer_cursors, pointerCursors);
    const nextSidebarTranslucent = toStoredBool(importedTheme.sidebar_translucent, sidebarTranslucent);
    const nextContrast = Number(importedTheme.contrast || contrast);
    const nextInterfaceFontSize = Number(importedTheme.interface_font_size || interfaceFontSize);
    const nextCodeFontSize = Number(importedTheme.code_font_size || codeFontSize);

    setTheme(importedTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setLanguage(nextLanguage);
    setPointerCursors(nextPointerCursors);
    setSidebarTranslucent(nextSidebarTranslucent);
    setContrast(nextContrast);
    setInterfaceFontSize(nextInterfaceFontSize);
    setCodeFontSize(nextCodeFontSize);
    applyThemeToCSS(importedTheme, nextMode, nextAccent);

    if (nextLanguage !== i18n.language) {
      i18n.changeLanguage(nextLanguage);
    }
  };

  const importTheme = async (file?: File) => {
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text()) as ThemeConfig;
      if (!imported || typeof imported !== 'object' || !imported.bg || !imported.fg || !imported.accent) {
        throw new Error('Invalid theme');
      }
      applyImportedTheme(imported);
      addToast({ message: 'Tema importado', type: 'success' });
    } catch {
      addToast({ message: 'No se pudo importar el tema', type: 'error' });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const copyTheme = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify(buildThemePayload(), null, 2));
      addToast({ message: 'Tema copiado', type: 'success' });
    } catch {
      addToast({ message: 'No se pudo copiar el tema', type: 'error' });
    }
  };

  if (!theme || !visibleTheme) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-muted)] animate-fade-in">
        {t('appearance.loading') || 'Cargando...'}
      </div>
    );
  }

  return (
    <div data-testid="appearance-view" className="h-full min-h-0 w-full overflow-auto bg-[var(--bg-base)] px-5 py-4 text-[var(--text-primary)] animate-fade-in">
      <div data-testid="appearance-workspace" className="mx-auto min-h-0 w-full max-w-[760px]">
        <h1 className="mb-9 text-[19px] font-semibold tracking-normal text-[var(--text-primary)]">Aspecto</h1>

        <section className="overflow-visible rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)]">
          <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12px] font-semibold text-[var(--text-primary)]">Tema</div>
              <div className="mt-1 text-[12px] text-[var(--text-secondary)]">Usa claro, oscuro o el tema del sistema</div>
            </div>
            <div className="inline-flex items-center rounded-full bg-[var(--bg-elevated)] p-0.5">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = mode === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => updateMode(option.key)}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                      active ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon size={14} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid overflow-hidden border-b border-[var(--border-subtle)] bg-black sm:grid-cols-2">
            <div className="border-b border-[var(--border-subtle)] sm:border-b-0 sm:border-r">
              <div className="grid grid-cols-[34px_1fr] font-mono text-[11px] leading-[1.55]">
                {[1, 2, 3, 4, 5].map((line) => (
                  <div key={`left-${line}`} className={`px-2 text-right ${line > 1 && line < 5 ? 'bg-red-950/45 text-red-300' : 'text-slate-400'}`}>{line}</div>
                ))}
                <code className="col-start-2 row-start-1 whitespace-pre px-3 text-[#c084fc]">const <span className="text-[#fb923c]">themePreview</span>: <span className="text-[#818cf8]">ThemeConfig</span> = {'{'}</code>
                <code className="col-start-2 row-start-2 whitespace-pre bg-red-950/45 px-3 text-[#fb923c]">  surface: <span className="text-[#86efac]">"sidebar"</span>,</code>
                <code className="col-start-2 row-start-3 whitespace-pre bg-red-950/45 px-3 text-[#fb923c]">  accent: <span className="text-[#86efac]">"{visibleTheme.accent}"</span>,</code>
                <code className="col-start-2 row-start-4 whitespace-pre bg-red-950/45 px-3 text-[#fb923c]">  contrast: <span className="text-[#67e8f9]">{Math.max(1, Math.round(contrast * 0.7))}</span>,</code>
                <code className="col-start-2 row-start-5 whitespace-pre px-3 text-slate-200">{'};'}</code>
              </div>
            </div>
            <div>
              <div className="grid grid-cols-[34px_1fr] font-mono text-[11px] leading-[1.55]">
                {[1, 2, 3, 4, 5].map((line) => (
                  <div key={`right-${line}`} className={`px-2 text-right ${line > 1 && line < 5 ? 'bg-emerald-950/45 text-emerald-300' : 'text-slate-400'}`}>{line}</div>
                ))}
                <code className="col-start-2 row-start-1 whitespace-pre px-3 text-[#c084fc]">const <span className="text-[#fb923c]">themePreview</span>: <span className="text-[#818cf8]">ThemeConfig</span> = {'{'}</code>
                <code className="col-start-2 row-start-2 whitespace-pre bg-emerald-950/45 px-3 text-[#fb923c]">  surface: <span className="text-[#86efac]">"sidebar-elevated"</span>,</code>
                <code className="col-start-2 row-start-3 whitespace-pre bg-emerald-950/45 px-3 text-[#fb923c]">  accent: <span className="text-[#86efac]">"{visibleTheme.accent_light}"</span>,</code>
                <code className="col-start-2 row-start-4 whitespace-pre bg-emerald-950/45 px-3 text-[#fb923c]">  contrast: <span className="text-[#67e8f9]">{contrast}</span>,</code>
                <code className="col-start-2 row-start-5 whitespace-pre px-3 text-slate-200">{'};'}</code>
              </div>
            </div>
          </div>

          <div className="m-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)]">
            <div className="flex min-h-[43px] flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
              <div className="mr-auto text-[12px] font-semibold text-[var(--text-secondary)]">Tema oscuro</div>
              <input
                ref={importInputRef}
                aria-label="Importar tema"
                type="file"
                accept="application/json,.json"
                onChange={(event) => importTheme(event.target.files?.[0])}
                className="sr-only"
              />
              <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Upload size={13} />
                Importar
              </button>
              <button type="button" onClick={copyTheme} className="inline-flex items-center gap-1.5 px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Copy size={13} />
                Copiar tema
              </button>
              <div className="relative min-w-[240px] flex-1 sm:flex-none">
                <button
                  type="button"
                  onClick={() => setPresetOpen((value) => !value)}
                  className="flex h-8 w-full items-center gap-2 rounded-lg bg-[var(--bg-input)] px-3 text-left text-[12px] font-medium text-[var(--text-primary)]"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-black text-[10px] font-bold text-white">
                    <Type size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{displayPresetName(theme.name)}</span>
                  <ChevronDown size={15} className={`text-[var(--text-secondary)] transition-transform ${presetOpen ? 'rotate-180' : ''}`} />
                </button>
                {presetOpen && (
                  <div className="absolute right-0 z-20 mt-1 max-h-[320px] w-full overflow-auto rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-2xl">
                    {presets.map((name) => {
                      const active = theme.name === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => applyPreset(name)}
                          className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors ${
                            active ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-[var(--border-medium)] text-[10px] font-bold" style={{ color: active ? visibleTheme.accent : undefined }}>
                            Aa
                          </span>
                          <span className="min-w-0 flex-1 truncate">{displayPresetName(name)}</span>
                          {active && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {EDITABLE_COLORS.map((item) => {
              const value = visibleTheme[item.key] || '#000000';
              return (
                <SettingRow key={item.key} label={item.label}>
                  <label className="flex h-7 w-full max-w-[136px] items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-2">
                    <input
                      aria-label={item.label}
                      type="color"
                      value={value}
                      onChange={(event) => updateThemeColor(item.key, event.target.value)}
                      className="h-4 w-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(event) => updateThemeColor(item.key, event.target.value)}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[11px] font-semibold text-[var(--text-primary)] outline-none"
                    />
                  </label>
                </SettingRow>
              );
            })}

            <div className="flex min-h-[36px] items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-2">
              <div className="text-[12px] font-semibold leading-4 text-[var(--text-primary)]">Acentos rapidos</div>
              <div className="flex flex-nowrap items-center justify-end gap-1">
                {ACCENTS.map((item) => {
                  const isActive = accent === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setAccent(item.key);
                        const nextTheme = {
                          ...theme,
                          accent: item.color,
                          accent_key: item.key,
                          accent_light: item.light,
                          accent_hover: item.hover,
                          accent_dark: item.dark,
                          orange: item.light,
                        } as ThemeConfig;
                        setTheme(nextTheme);
                        applyThemeToCSS(nextTheme, mode, item.key);
                      }}
                      className={`h-4 w-4 shrink-0 rounded-full border transition-all ${
                        isActive ? 'border-[var(--text-primary)] scale-110' : 'border-transparent hover:border-[var(--text-secondary)]'
                      }`}
                      style={{ backgroundColor: item.color }}
                      title={item.key}
                    />
                  );
                })}
              </div>
            </div>

            <SettingRow label="Fuente de la interfaz">
              <input
                value={theme.interface_font || '-apple-system, BlinkMacSystemFont'}
                onChange={(event) => patchTheme({ interface_font: event.target.value } as Partial<ThemeConfig>)}
                className="h-7 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-2 text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-primary)]"
              />
            </SettingRow>
            <SettingRow label="Fuente de codigo">
              <input
                value={theme.code_font || 'ui-monospace, SFMono-Regular'}
                onChange={(event) => patchTheme({ code_font: event.target.value } as Partial<ThemeConfig>)}
                className="h-7 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-2 font-mono text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-primary)]"
              />
            </SettingRow>
            <SettingRow label="Barra lateral translucida">
              <Toggle checked={sidebarTranslucent} onChange={(value) => updateBool('sidebar_translucent', value)} />
            </SettingRow>
            <SettingRow label="Contraste">
              <div className="flex w-full items-center gap-3">
                <input
                  aria-label="Contraste"
                  type="range"
                  min={1}
                  max={100}
                  value={contrast}
                  onChange={(event) => updateNumber('contrast', Number(event.target.value))}
                  className="min-w-0 flex-1 accent-[var(--accent-primary)]"
                />
                <span className="w-7 text-right text-[12px] font-medium text-[var(--text-primary)]">{contrast}</span>
              </div>
            </SettingRow>
          </div>

          <SettingRow label="Usar cursores de puntero" hint="Cambia el cursor a un puntero al pasar sobre elementos interactivos">
            <Toggle checked={pointerCursors} onChange={(value) => updateBool('pointer_cursors', value)} />
          </SettingRow>
          <SettingRow label="Tamano de fuente de la interfaz" hint="Ajusta el tamano base usado para la interfaz de HidroConvert">
            <div className="flex items-center gap-2">
              <input
                aria-label="Tamano de fuente de la interfaz"
                type="number"
                min={10}
                max={18}
                value={interfaceFontSize}
                onChange={(event) => updateNumber('interface_font_size', Number(event.target.value))}
                className="h-7 w-16 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-center text-[12px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
              />
              <span className="text-[11px] text-[var(--text-secondary)]">px</span>
            </div>
          </SettingRow>
          <SettingRow label="Tamano de fuente del codigo" hint="Ajusta el tamano base usado para el codigo en chats y diffs">
            <div className="flex items-center gap-2">
              <input
                aria-label="Tamano de fuente del codigo"
                type="number"
                min={10}
                max={18}
                value={codeFontSize}
                onChange={(event) => updateNumber('code_font_size', Number(event.target.value))}
                className="h-7 w-16 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-center text-[12px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
              />
              <span className="text-[11px] text-[var(--text-secondary)]">px</span>
            </div>
          </SettingRow>
        </section>

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
            <RotateCcw size={14} />
            Restaurar
          </button>
          <button type="button" onClick={save} className="inline-flex h-8 items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-3 text-[12px] font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)]">
            <Save size={14} />
            Guardar
          </button>
          <select
            aria-label="Idioma"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              i18n.changeLanguage(event.target.value);
            }}
            className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="es">ES</option>
            <option value="en">EN</option>
          </select>
        </div>

        <div className="sr-only">
          <Laptop size={1} />
        </div>
      </div>
    </div>
  );
}
