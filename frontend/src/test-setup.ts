import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});

// jsdom does not implement ResizeObserver (used by virtualized lists/grids).
if (typeof globalThis.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = target.getBoundingClientRect?.() ?? { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0, toJSON: () => ({}) };
      this.callback(
        [{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom does not implement matchMedia; EspaciosWelcome / LoginScreen need it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const defaultTheme = {
  name: 'Precision Linear', bg: '#0A0D12', bg_secondary: '#111522',
  fg: '#FFFFFF', fg_muted: '#7C8494', accent: '#5E6AD2',
  accent_light: '#8B93FF', accent_hover: '#4D57BE',
  accent_dark: '#343B8F', border: '#27304E', blue_hover: '#22C7A9',
  error: '#EB001B', warning: '#F79E1B', success: '#76b900', orange: '#8B93FF',
};

// Mock electronAPI for tests
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'version') return { version: '0.10.6' };
      if (method === 'formats') return { formats: ['JPEG', 'PNG', 'WEBP'] };
      if (method === 'formatos_list') return { formats: [] };
      if (method === 'db_records') return { records: [], fields: ['codigo'] };
      if (method === 'db_fields') return { fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] };
      if (method === 'theme_get') return defaultTheme;
      if (method === 'theme_presets') return { presets: ['Precision Linear'] };
      if (method === 'history_list') return { runs: [] };
      if (method === 'technical_reports_list') return { reports: [] };
      if (method === 'templates_list') return { templates: [] };
      return {};
    },
    onNotify: () => () => {},
    onUpdateAvailable: () => () => {},
    onUpdateDownloaded: () => () => {},
    minimizeWindow: async () => ({}),
    maximizeWindow: async () => ({}),
    closeWindow: async () => ({}),
    showAppMenu: async () => ({}),
  },
  writable: true,
});
}

// Mock Vite env vars for Supabase tests
Object.defineProperty(import.meta, 'env', {
  value: {
    ...import.meta.env,
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    DEV: true,
  },
  writable: true,
});
