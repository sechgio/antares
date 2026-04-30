import { useEffect, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { useMediaQuery } from './useMediaQuery';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'hc_theme_mode';

function applyThemeClass(mode: ThemeMode, systemDark: boolean) {
  const root = document.documentElement;
  const isDark = mode === 'system' ? systemDark : mode === 'dark';

  if (isDark) {
    root.classList.add('theme-dark');
    root.classList.remove('theme-light');
  } else {
    root.classList.add('theme-light');
    root.classList.remove('theme-dark');
  }

  localStorage.setItem(THEME_KEY, mode);
}

export function useThemeMode() {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setMode] = useLocalStorage<ThemeMode>(THEME_KEY, 'dark');

  useEffect(() => {
    applyThemeClass(mode, systemDark);
  }, [mode, systemDark]);

  const toggle = useCallback(() => {
    setMode((prev) => (prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark'));
  }, [setMode]);

  return { mode, setMode, toggle };
}