import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ThemeConfig } from '../types';
import Button from './ui/Button';
import { useToast } from '../hooks/useToast';

export default function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const { addToast } = useToast();

  const editableKeys = [
    { label: t('appearance.bg'), key: 'bg' },
    { label: t('appearance.bg_secondary'), key: 'bg_secondary' },
    { label: t('appearance.fg'), key: 'fg' },
    { label: t('appearance.fg_muted'), key: 'fg_muted' },
    { label: t('appearance.accent'), key: 'accent' },
    { label: t('appearance.accent_hover'), key: 'accent_hover' },
    { label: t('appearance.accent_light'), key: 'accent_light' },
    { label: t('appearance.border'), key: 'border' },
    { label: t('appearance.error'), key: 'error' },
    { label: t('appearance.warning'), key: 'warning' },
  ];

  const themeNameKey: Record<string, string> = {
    'Precision Linear': 'theme.precisionLinear',
  };

  const [theme, setTheme] = useState<ThemeConfig | null>(null);
  const [presets, setPresets] = useState<string[]>([]);

  function applyThemeToCSS(theme: Record<string, string>) {
    const root = document.documentElement;
    const mapping: Record<string, string> = {
      bg: '--mc-canvas',
      bg_secondary: '--mc-lifted',
      fg: '--mc-ink',
      fg_muted: '--mc-slate',
      fg_secondary: '--mc-granite',
      fg_tertiary: '--mc-graphite',
      accent: '--mc-signal',
      accent_light: '--mc-signalLight',
      accent_hover: '--mc-clay',
      accent_dark: '--mc-clay',
      border: '--mc-dust',
      blue_hover: '--mc-linkBlue',
      error: '--mc-red',
      warning: '--mc-yellow',
      success: '--mc-success',
      orange: '--mc-signalLight',
    };
    for (const [key, cssVar] of Object.entries(mapping)) {
      if (theme[key]) root.style.setProperty(cssVar, theme[key]);
    }
    if (theme.bg_secondary) {
      root.style.setProperty('--mc-white', theme.bg_secondary);
    }
    if (theme.bg) {
      root.style.setProperty('--mc-bone', theme.bg_secondary || theme.bg);
    }
  }

  const refresh = async () => {
    const t = await api.getTheme();
    setTheme(t);
    applyThemeToCSS(t);
    const p = await api.getPresets();
    setPresets(p.presets);
  };

  useEffect(() => { refresh(); }, []);

  const applyPreset = async (name: string) => {
    const t = await api.applyPreset(name);
    setTheme(t);
    applyThemeToCSS(t);
  };

  const save = async () => {
    if (!theme) return;
    await api.saveTheme(theme);
    applyThemeToCSS(theme);
    addToast({ message: t('appearance.savedAlert') || 'Tema guardado', type: 'success' });
  };

  const reset = async () => {
    const t = await api.resetTheme();
    setTheme(t);
    applyThemeToCSS(t);
  };

  const updateColor = (key: string, value: string) => {
    setTheme((prev: ThemeConfig | null) => (prev ? { ...prev, [key]: value } : prev));
  };

  const themeVal = (key: string) => (theme as Record<string, string>)[key] || '';

  if (!theme) return (
    <div className="flex items-center justify-center h-full text-txt-muted animate-fade-in">
      {t('appearance.loading')}
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full bg-dark-base p-6 overflow-y-auto">
      <div className="mb-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-txt-muted mb-1">{t('appearance.personalization')}</div>
        <h2 className="text-xl font-semibold text-txt-primary tracking-tight">{t('appearance.title')}</h2>
      </div>

      {/* Presets horizontal row */}
      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-txt-muted mb-3">{t('appearance.presets')}</div>
        <div className="flex flex-wrap gap-2">
          {presets.map((name) => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              className={`flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium transition-all duration-200 ${
                theme.name === name
                  ? 'bg-accent text-white shadow-glow'
                  : 'bg-dark-elevated text-txt-secondary hover:text-txt-primary border border-bdr-subtle'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-bdr-medium"
                style={{ backgroundColor: themeVal('accent') || '#5E6AD2' }}
              />
              {themeNameKey[name] ? t(themeNameKey[name]) : name}
            </button>
          ))}
        </div>
      </div>

      {/* Color editor grid */}
      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-txt-muted mb-3">{t('appearance.editor')} &mdash; {t('appearance.colors')}</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {editableKeys.map((k) => (
            <div
              key={k.key}
              className="flex items-center gap-3 p-3 rounded-card bg-dark-surface border border-bdr-subtle transition-colors hover:border-bdr-medium"
            >
              <span className="text-sm text-txt-primary flex-1 font-medium min-w-0 truncate" title={k.label}>{k.label}</span>
              <div className="relative w-8 h-8 rounded-full overflow-hidden border border-bdr-medium shrink-0">
                <input
                  type="color"
                  value={themeVal(k.key) || '#000000'}
                  onChange={(e) => updateColor(k.key, e.target.value)}
                  className="absolute -top-2 -left-2 w-14 h-14 p-0 border-0 cursor-pointer"
                />
              </div>
              <input
                className="w-20 font-mono text-xs py-1.5 px-2 bg-dark-input border border-bdr-medium rounded-sm text-txt-primary focus:border-accent focus:outline-none"
                value={themeVal(k.key)}
                onChange={(e) => updateColor(k.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Language selector */}
      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-txt-muted mb-2">{t('appearance.lang')}</div>
        <select
          className="w-48 appearance-none cursor-pointer py-2 px-3 font-medium bg-dark-input border border-bdr-medium rounded-sm text-txt-primary focus:border-accent focus:outline-none"
          value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button variant="primary" onClick={save}>{t('appearance.save')}</Button>
        <Button variant="ghost" onClick={reset}>{t('appearance.reset')}</Button>
      </div>
    </div>
  );
}
