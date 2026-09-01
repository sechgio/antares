import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeConfig } from '../../types';
import {
  THEME_ACTIVE_CACHE_KEY,
  THEME_CSS_CACHE_KEY,
  THEME_DENSITY_CACHE_KEY,
  THEME_MODE_CACHE_KEY,
  applyThemeToCSS,
  bootThemeFromBackend,
  restoreCachedTheme,
} from './themeApplier';

const backendTheme: ThemeConfig = {
  name: 'Vanta Black',
  bg: '#000000',
  bg_secondary: '#0A0A0A',
  fg: '#FFFFFF',
  fg_muted: '#A0A0A0',
  fg_secondary: '#CCCCCC',
  fg_tertiary: '#888888',
  accent: '#00FF88',
  accent_light: '#66FFBB',
  accent_hover: '#00CC6E',
  accent_dark: '#009955',
  border: '#222222',
  blue_hover: '#00FF88',
  error: '#FF4444',
  warning: '#FFAA00',
  success: '#22C55E',
  orange: '#66FFBB',
  mode: 'dark',
  accent_key: 'custom',
  language: 'es',
  pointer_cursors: 'true',
  sidebar_translucent: 'false',
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme-mode');
  document.documentElement.removeAttribute('data-theme-density');
  document.documentElement.removeAttribute('data-pointer-cursors');
  document.documentElement.removeAttribute('data-sidebar-translucent');
  document.documentElement.style.cssText = '';
});

describe('restoreCachedTheme', () => {
  it('restores pointer/sidebar flags from the active cache on boot', () => {
    localStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify({ '--accent-primary': '#00FF88' }));
    localStorage.setItem(THEME_MODE_CACHE_KEY, 'dark');
    localStorage.setItem(THEME_DENSITY_CACHE_KEY, 'compact');
    localStorage.setItem(THEME_ACTIVE_CACHE_KEY, JSON.stringify(backendTheme));

    restoreCachedTheme();

    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#00FF88');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeDensity).toBe('compact');
    expect(document.documentElement.dataset.pointerCursors).toBe('true');
    expect(document.documentElement.dataset.sidebarTranslucent).toBe('false');
  });

  it('does nothing when no css cache exists', () => {
    restoreCachedTheme();
    expect(document.documentElement.dataset.themeMode).toBeUndefined();
    expect(document.documentElement.dataset.pointerCursors).toBeUndefined();
  });

  it('survives a corrupt css cache', () => {
    localStorage.setItem(THEME_CSS_CACHE_KEY, '{not json');
    expect(() => restoreCachedTheme()).not.toThrow();
  });
});

describe('bootThemeFromBackend', () => {
  it('applies the backend theme as authority over the cached css', async () => {
    // Stale cache painted first (old accent)
    localStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify({ '--accent-primary': '#FF0000' }));
    restoreCachedTheme();
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#FF0000');

    const cancel = bootThemeFromBackend(async () => backendTheme);
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#00FF88');
    });

    // Cache is re-written with the backend theme so future boots stay consistent
    const cached = JSON.parse(localStorage.getItem(THEME_CSS_CACHE_KEY) || '{}') as Record<string, string>;
    expect(cached['--accent-primary']).toBe('#00FF88');
    expect(localStorage.getItem(THEME_ACTIVE_CACHE_KEY)).toContain('"mode":"dark"');
    cancel();
  });

  it('keeps the cached theme when the backend fetch fails', async () => {
    localStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify({ '--accent-primary': '#FF0000' }));
    restoreCachedTheme();

    const cancel = bootThemeFromBackend(async () => {
      throw new Error('IPC down');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#FF0000');
    cancel();
  });

  it('does not apply after cancel', async () => {
    let resolveFetch: (t: ThemeConfig) => void = () => {};
    const cancel = bootThemeFromBackend(
      () => new Promise<ThemeConfig>((resolve) => { resolveFetch = resolve; }),
    );
    cancel();
    resolveFetch(backendTheme);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
  });

  it('does not overwrite a theme edited while the fetch was in flight', async () => {
    let resolveFetch: (t: ThemeConfig) => void = () => {};
    const cancel = bootThemeFromBackend(
      () => new Promise<ThemeConfig>((resolve) => { resolveFetch = resolve; }),
    );
    // User edits during the flight: the active cache is re-written.
    localStorage.setItem(THEME_ACTIVE_CACHE_KEY, JSON.stringify({ ...backendTheme, accent: '#123456' }));
    resolveFetch(backendTheme);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
    cancel();
  });
});

describe('applyThemeToCSS', () => {
  it('persists the composed theme into all caches', () => {
    applyThemeToCSS(backendTheme, 'dark', 'custom');

    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.pointerCursors).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--app-contrast')).toBe('60');
    expect(localStorage.getItem(THEME_MODE_CACHE_KEY)).toBe('dark');
    expect(localStorage.getItem(THEME_DENSITY_CACHE_KEY)).toBeTruthy();
    expect(localStorage.getItem(THEME_ACTIVE_CACHE_KEY)).toContain('Vanta Black');
  });

  it('applies appearance preferences to the live DOM contract', () => {
    applyThemeToCSS(
      {
        ...backendTheme,
        contrast: '100',
        density: 'compact',
        sidebar_translucent: 'true',
      },
      'dark',
      'custom',
    );

    expect(document.documentElement.style.getPropertyValue('--app-contrast')).toBe('100');
    expect(document.documentElement.style.getPropertyValue('--app-density-scale')).toBe('0.88');
    expect(document.documentElement.style.getPropertyValue('--text-secondary')).toBe('#FFFFFF');
    expect(document.documentElement.dataset.themeDensity).toBe('compact');
    expect(document.documentElement.dataset.sidebarTranslucent).toBe('true');
    expect(localStorage.getItem(THEME_DENSITY_CACHE_KEY)).toBe('compact');
  });

  it('marks a light custom theme for legacy module selectors', () => {
    applyThemeToCSS({ ...backendTheme, bg: '#FFFFFF', bg_secondary: '#F8FAFC' }, 'dark', 'custom');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });
});
