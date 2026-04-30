import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Languages,
  LayoutList,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Type,
} from 'lucide-react';
import { api } from '../../api';
import { ThemeConfig } from '../../types';
import Button from '../ui/Button';
import Toggle from '../ui/Toggle';
import { useToast } from '../../hooks/useToast';

type ThemeMode = 'dark' | 'light' | 'system';
type DensityMode = 'comfortable' | 'compact';

type AccentChoice = {
  key: string;
  name: string;
  color: string;
  hover: string;
  light: string;
  dark: string;
};

type PresetPreview = {
  name: string;
  description: string;
  colors: string[];
};

type EditableColor = {
  key: keyof ThemeConfig;
  label: string;
  description: string;
};

const CUSTOM_ACCENT_KEY = 'custom';

const ACCENTS: AccentChoice[] = [
  { key: 'violet', name: 'Azul', color: '#3B82F6', hover: '#2563EB', light: '#93C5FD', dark: '#1E40AF' },
  { key: 'blue', name: 'Pizarra', color: '#475467', hover: '#344054', light: '#D0D5DD', dark: '#101828' },
  { key: 'teal', name: 'Turquesa', color: '#14B8A6', hover: '#0F766E', light: '#5EEAD4', dark: '#115E59' },
  { key: 'green', name: 'Oliva', color: '#84CC16', hover: '#65A30D', light: '#BEF264', dark: '#365314' },
  { key: 'amber', name: 'Ambar', color: '#F59E0B', hover: '#D97706', light: '#FCD34D', dark: '#92400E' },
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

const PRESET_PREVIEWS: Record<string, PresetPreview> = {
  'Slate Professional': {
    name: 'Slate Professional',
    description: 'Azul acero sobrio, equilibrado para trabajo continuo.',
    colors: ['#0F172A', '#172033', '#3B82F6', '#14B8A6'],
  },
  'Graphite Focus': {
    name: 'Graphite Focus',
    description: 'Grafito neutral con acento lima para buena lectura.',
    colors: ['#111315', '#1B1F23', '#A3E635', '#38BDF8'],
  },
  'Porcelain Light': {
    name: 'Porcelain Light',
    description: 'Claro profesional con contraste suave y acento gris.',
    colors: ['#F7F8FA', '#FFFFFF', '#475467', '#0EA5E9'],
  },
  'Steel Blue': {
    name: 'Steel Blue',
    description: 'Azules técnicos sin saturación de marca.',
    colors: ['#08111F', '#102033', '#38BDF8', '#22D3EE'],
  },
  'Olive Operations': {
    name: 'Olive Operations',
    description: 'Verde oliva discreto para flujos operativos.',
    colors: ['#10140D', '#1B2316', '#84CC16', '#2DD4BF'],
  },
  'Copper Night': {
    name: 'Copper Night',
    description: 'Oscuro cálido con cobre controlado y elegante.',
    colors: ['#17110D', '#241A14', '#F97316', '#38BDF8'],
  },
  'Mono Contrast': {
    name: 'Mono Contrast',
    description: 'Contraste máximo con colores directos y legibles.',
    colors: ['#000000', '#111111', '#FFFF00', '#FFFFFF'],
  },
  'Precision Linear': {
    name: 'Precision Linear',
    description: 'Legado violeta, conservado para compatibilidad.',
    colors: ['#0A0D12', '#111522', '#5E6AD2', '#8B93FF'],
  },
  'NVIDIA Dark': {
    name: 'NVIDIA Dark',
    description: 'Negro técnico con acentos verdes de alto contraste.',
    colors: ['#000000', '#1A1A1A', '#76B900', '#BFF230'],
  },
  'Professional Light': {
    name: 'Professional Light',
    description: 'Claro, limpio y cómodo para sesiones largas.',
    colors: ['#F5F5F5', '#FFFFFF', '#2563EB', '#9BDB00'],
  },
  'Midnight Blue': {
    name: 'Midnight Blue',
    description: 'Azules profundos con acento cian para enfoque visual.',
    colors: ['#0A0E1A', '#121A2B', '#00D4FF', '#FF6B35'],
  },
  'Carbon Gray': {
    name: 'Carbon Gray',
    description: 'Gris grafito con acento cálido y buena separación.',
    colors: ['#181818', '#242424', '#FF9500', '#00BCD4'],
  },
  'High Contrast': {
    name: 'High Contrast',
    description: 'Máxima legibilidad con bordes fuertes y colores directos.',
    colors: ['#000000', '#111111', '#FFFF00', '#FFFFFF'],
  },
  'Solar Claro': {
    name: 'Solar Claro',
    description: 'Claro luminoso con azul técnico y superficies limpias.',
    colors: ['#F8FAFC', '#FFFFFF', '#0EA5E9', '#14B8A6'],
  },
  'Bosque Operativo': {
    name: 'Bosque Operativo',
    description: 'Verdes profundos para una interfaz operacional y estable.',
    colors: ['#07130F', '#10231D', '#22C55E', '#2DD4BF'],
  },
  'Amanecer Ambar': {
    name: 'Amanecer Ambar',
    description: 'Oscuro cálido con acentos ámbar y naranja.',
    colors: ['#1C1208', '#2A1A0D', '#F59E0B', '#FB923C'],
  },
  'Neon Grid': {
    name: 'Neon Grid',
    description: 'Contraste violeta/cian para una apariencia más expresiva.',
    colors: ['#070713', '#111126', '#22D3EE', '#A855F7'],
  },
};

const MODE_OPTIONS: { key: ThemeMode; label: string; description: string; icon: typeof Moon }[] = [
  { key: 'dark', label: 'Oscuro', description: 'Interfaz de bajo brillo.', icon: Moon },
  { key: 'light', label: 'Claro', description: 'Superficies luminosas.', icon: Sun },
  { key: 'system', label: 'Sistema', description: 'Sigue Windows.', icon: Monitor },
];

const EDITABLE_COLORS: EditableColor[] = [
  { key: 'bg', label: 'Fondo principal', description: 'Canvas general de la app.' },
  { key: 'bg_secondary', label: 'Superficie', description: 'Paneles, sidebar y tarjetas.' },
  { key: 'fg', label: 'Texto principal', description: 'Titulares y texto de alto énfasis.' },
  { key: 'fg_muted', label: 'Texto secundario', description: 'Ayudas, descripciones y metadatos.' },
  { key: 'accent', label: 'Acento principal', description: 'Acciones primarias y selección.' },
  { key: 'accent_hover', label: 'Acento hover', description: 'Interacciones sobre botones y foco.' },
  { key: 'accent_light', label: 'Acento claro', description: 'Brillos, previews y estados suaves.' },
  { key: 'border', label: 'Bordes', description: 'Separadores y contornos.' },
  { key: 'success', label: 'Éxito', description: 'Estados completados.' },
  { key: 'warning', label: 'Advertencia', description: 'Alertas preventivas.' },
  { key: 'error', label: 'Error', description: 'Estados fallidos.' },
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
  return fallback === 'violet' && theme.accent ? CUSTOM_ACCENT_KEY : normalizeAccentKey(fallback);
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

  Object.entries(CSS_VAR_MAP).forEach(([key, cssVars]) => {
    const value = nextTheme[key];
    if (!value) return;
    cssVars.forEach((cssVar) => root.style.setProperty(cssVar, value));
  });

  root.style.setProperty('--bg-elevated', elevated);
  root.style.setProperty('--bg-input', input);
  root.style.setProperty('--border-medium', mediumBorder);
  root.style.setProperty('--mc-lifted', elevated);
  root.style.setProperty('--mc-ghost', elevated);
  root.style.setProperty('--text-secondary-strong', nextTheme.fg_secondary || nextTheme.fg_muted);
  root.style.setProperty('--text-muted', nextTheme.fg_muted);
  root.style.setProperty('--text-tertiary', nextTheme.fg_tertiary || nextTheme.fg_muted);
  root.style.setProperty('--text-on-accent', readableTextFor(nextTheme.accent));
  root.style.setProperty('--accent-primary-glow', `${nextTheme.accent}33`);
  root.style.setProperty('--accent-orange-glow', `${nextTheme.accent}33`);
  root.style.setProperty('--scrollbar-thumb', `${nextTheme.fg_muted}55`);
  root.style.setProperty('--scrollbar-thumb-hover', `${nextTheme.fg_muted}88`);
  root.style.setProperty('--selection-bg', `${nextTheme.accent}55`);
  root.style.setProperty('--selection-fg', readableTextFor(nextTheme.accent));
  root.dataset.themeMode = mode;
}

function getPresetPreview(name: string, activeTheme?: ThemeConfig | null): PresetPreview {
  if (PRESET_PREVIEWS[name]) return PRESET_PREVIEWS[name];
  return {
    name,
    description: 'Estilo personalizado guardado en la aplicacion.',
    colors: [
      activeTheme?.bg || '#0A0A0A',
      activeTheme?.bg_secondary || '#1A1A1A',
      activeTheme?.accent || '#5E6AD2',
      activeTheme?.accent_light || '#8B93FF',
    ],
  };
}

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Palette;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Icon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--text-primary)]">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{description}</span>
        </span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function AppearanceView() {
  const { t, i18n } = useTranslation();
  const { addToast } = useToast();
  const [theme, setTheme] = useState<ThemeConfig | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [accent, setAccent] = useState('violet');
  const [density, setDensity] = useState<DensityMode>('comfortable');
  const [language, setLanguage] = useState(i18n.language || 'es');

  useEffect(() => { setLanguage(i18n.language); }, [i18n.language]);

  const refresh = useCallback(async () => {
    const backendTheme = await api.getTheme();
    const nextMode = (backendTheme?.mode as ThemeMode) || 'dark';
    const nextAccent = accentKeyForTheme(backendTheme);
    const nextDensity = ((backendTheme?.density as DensityMode) || 'comfortable');
    const nextLanguage = backendTheme?.language || i18n.language || 'es';

    setTheme(backendTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setDensity(nextDensity);
    setLanguage(nextLanguage);
    applyThemeToCSS(backendTheme, nextMode, nextAccent);
    document.documentElement.dataset.themeDensity = nextDensity;

    const presetResponse = await api.getPresets();
    setPresets(presetResponse.presets);
  }, [i18n.language]);

  useEffect(() => { refresh(); }, [refresh]);

  const visibleTheme = useMemo(() => {
    if (!theme) return null;
    return composeTheme(theme, mode, accent);
  }, [theme, mode, accent]);

  const updateMode = (value: ThemeMode) => {
    setMode(value);
    if (theme) applyThemeToCSS(theme, value, accent);
  };

  const updateAccent = (value: string) => {
    setAccent(value);
    if (theme) applyThemeToCSS(theme, mode, value);
  };

  const updateThemeColor = (key: keyof ThemeConfig, value: string) => {
    const normalized = normalizeHexColor(value);
    if (!theme || !normalized) return;
    const nextTheme = {
      ...theme,
      [key]: normalized,
      ...(key === 'accent'
        ? {
            accent_key: CUSTOM_ACCENT_KEY,
            orange: normalized,
          }
        : {}),
    } as ThemeConfig;
    const nextAccent = key === 'accent' ? CUSTOM_ACCENT_KEY : accent;
    setTheme(nextTheme);
    setAccent(nextAccent);
    applyThemeToCSS(nextTheme, mode, nextAccent);
  };

  const updateDensity = (compact: boolean) => {
    const nextDensity = compact ? 'compact' : 'comfortable';
    setDensity(nextDensity);
    document.documentElement.dataset.themeDensity = nextDensity;
  };

  const buildThemePayload = (): ThemeConfig => {
    const base = theme || ({} as ThemeConfig);
    return {
      ...composeTheme(base, mode, accent),
      density,
      language,
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
    const nextDensity = ((resetTheme?.density as DensityMode) || 'comfortable');
    const nextLanguage = resetTheme?.language || 'es';

    setTheme(resetTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setDensity(nextDensity);
    setLanguage(nextLanguage);
    applyThemeToCSS(resetTheme, nextMode, nextAccent);
    document.documentElement.dataset.themeDensity = nextDensity;

    if (nextLanguage !== i18n.language) {
      i18n.changeLanguage(nextLanguage);
    }
    addToast({ message: t('appearance.resetAlert') || 'Tema restaurado', type: 'success' });
  };

  const applyPreset = async (name: string) => {
    const presetTheme = await api.applyPreset(name);
    const nextMode = (presetTheme?.mode as ThemeMode) || mode;
    const nextAccent = accentKeyForTheme(presetTheme, accent);
    const nextDensity = ((presetTheme?.density as DensityMode) || density);
    const nextLanguage = presetTheme?.language || language;

    setTheme(presetTheme);
    setMode(nextMode);
    setAccent(nextAccent);
    setDensity(nextDensity);
    setLanguage(nextLanguage);
    applyThemeToCSS(presetTheme, nextMode, nextAccent);
    document.documentElement.dataset.themeDensity = nextDensity;
    addToast({ message: `Estilo "${name}" aplicado`, type: 'success' });
  };

  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    i18n.changeLanguage(value);
  };

  if (!theme || !visibleTheme) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-muted)] animate-fade-in">
        {t('appearance.loading') || 'Cargando...'}
      </div>
    );
  }

  return (
    <div data-testid="appearance-view" className="flex h-full min-h-0 w-full max-w-none flex-col animate-fade-in">
      <div className="mb-5 flex shrink-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <span className="eyebrow">Ajustes</span>
          <h2 className="mt-1 text-xl font-semibold tracking-[0] text-[var(--text-primary)]">
            {t('appearance.title') || 'Apariencia'}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            Configura el tema, los estilos visuales y la densidad de la interfaz.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <Button variant="primary" onClick={save}>
            <Save size={16} />
            Guardar cambios
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RotateCcw size={16} />
            {t('appearance.reset') || 'Restaurar'}
          </Button>
        </div>
      </div>

      <div
        data-testid="appearance-workspace"
        className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"
      >
        <div className="min-h-0 space-y-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-[var(--text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Preferencias</h3>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <SettingRow
                icon={Monitor}
                title="Modo de tema"
                description="Elige la base de luminosidad para toda la aplicacion."
              >
                <div className="grid w-full grid-cols-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
                  {MODE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = mode === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => updateMode(option.key)}
                        className={`flex items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-semibold transition-all ${
                          active
                            ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        title={option.description}
                      >
                        <Icon size={14} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>

              <SettingRow
                icon={LayoutList}
                title="Densidad compacta"
                description="Reduce el espacio vertical para ver mas informacion en pantalla."
              >
                <Toggle checked={density === 'compact'} onChange={updateDensity} />
              </SettingRow>

              <SettingRow
                icon={Languages}
                title="Idioma"
                description="Cambia el idioma de los textos principales de la interfaz."
              >
                <select
                  className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </SettingRow>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-[var(--text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Estilos de apariencia</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {presets.map((name) => {
                const preview = getPresetPreview(name, theme);
                const active = theme.name === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPreset(name)}
                    className={`group min-h-[112px] rounded-lg border p-3 text-left transition-all ${
                      active
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]'
                    }`}
                    aria-pressed={active}
                  >
                    <span className="mb-3 flex items-start justify-between gap-3">
                      <span>
                        <span className="block text-sm font-semibold text-[var(--text-primary)]">{preview.name}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{preview.description}</span>
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        active
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                          : 'border-[var(--border-medium)] text-transparent group-hover:text-[var(--text-secondary)]'
                      }`}>
                        <Check size={12} />
                      </span>
                    </span>
                    <span className="grid grid-cols-4 gap-2">
                      {preview.colors.map((color, index) => (
                        <span
                          key={`${name}-${color}-${index}`}
                          className="h-7 rounded-md border border-black/10"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Type size={16} className="text-[var(--text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Color de acento</h3>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {ACCENTS.map((item) => {
                const active = accent === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => updateAccent(item.key)}
                    className={`flex items-center justify-between rounded-lg border bg-[var(--bg-surface)] px-3 py-3 text-left transition-all ${
                      active
                        ? 'border-[var(--accent-primary)]'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="h-7 w-7 rounded-full border border-white/20" style={{ backgroundColor: item.color }} />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</span>
                    </span>
                    {active && <Check size={16} className="text-[var(--accent-primary)]" />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-[var(--text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Editor avanzado</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {EDITABLE_COLORS.map((item) => {
                const value = visibleTheme[item.key] || '#000000';
                return (
                  <label
                    key={item.key}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-3"
                  >
                    <span className="mb-2 block">
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">{item.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{item.description}</span>
                    </span>
                    <span className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
                      <input
                        aria-label={item.label}
                        type="color"
                        value={value}
                        onChange={(event) => updateThemeColor(item.key, event.target.value)}
                        className="h-10 w-11 cursor-pointer rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1"
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={(event) => updateThemeColor(item.key, event.target.value)}
                        className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs font-semibold text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="min-h-0 space-y-3 xl:sticky xl:top-0 xl:self-start">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Vista previa</h3>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 xl:min-h-[520px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 xl:min-h-[330px]">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">COSMO</span>
                </span>
                <span className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  {mode}
                </span>
              </div>
              <div className="space-y-2">
                <div className="h-9 rounded-md bg-[var(--accent-primary)]" />
                <div className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <span className="h-12 rounded-md bg-[var(--bg-surface)]" />
                  <span className="h-12 rounded-md bg-[var(--bg-surface)]" />
                  <span className="h-12 rounded-md bg-[var(--bg-surface)]" />
                </div>
                <div className="space-y-2 pt-2">
                  <div className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
                  <div className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
                </div>
              </div>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-secondary)]">Estilo</dt>
                <dd className="font-semibold text-[var(--text-primary)]">{visibleTheme.name}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-secondary)]">Acento</dt>
                <dd className="font-semibold text-[var(--text-primary)]">
                  {accent === CUSTOM_ACCENT_KEY ? 'Personalizado' : selectedAccent(accent).name}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-secondary)]">Densidad</dt>
                <dd className="font-semibold text-[var(--text-primary)]">
                  {density === 'compact' ? 'Compacta' : 'Comoda'}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
