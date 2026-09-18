import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from './i18n';

afterEach(async () => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  await i18n.changeLanguage('es');
});

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

// Ningún test debe abrir sockets reales (p. ej. Supabase Realtime vía undici).
// El stub satisface la API que usan los clientes pero nunca conecta.
if (typeof window !== 'undefined') {
  class WebSocketStub {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    binaryType: BinaryType = 'blob';
    bufferedAmount = 0;
    extensions = '';
    protocol = '';
    readyState = 0;
    url: string;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onopen: ((ev: Event) => void) | null = null;
    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = String(url);
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', {
    writable: true,
    configurable: true,
    value: WebSocketStub,
  });
}

const defaultTheme = {
  name: 'Precision Linear', bg: '#0A0D12', bg_secondary: '#111522',
  fg: '#FFFFFF', fg_muted: '#7C8494', accent: '#5E6AD2',
  accent_light: '#8B93FF', accent_hover: '#4D57BE',
  accent_dark: '#343B8F', border: '#27304E', blue_hover: '#22C7A9',
  error: '#EB001B', warning: '#F79E1B', success: '#76b900', orange: '#8B93FF',
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'version') return { version: '0.10.6' };
      if (method === 'formats') return { formats: ['JPEG', 'PNG', 'WEBP'] };
      if (method === 'formatos_list') return { formats: [] };
      if (method === 'db_fields') return { fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] };
      if (method === 'theme_get') return defaultTheme;
      if (method === 'theme_presets') return { presets: ['Precision Linear'] };
      if (method === 'history_list') return { runs: [] };
      if (method === 'technical_reports_list') return { reports: [] };
      if (method === 'templates_list') return { templates: [] };
      throw new Error(`IPC method not allowed: ${method} (test stub — añade el método al stub si el test lo necesita)`);
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

Object.defineProperty(import.meta, 'env', {
  value: {
    ...import.meta.env,
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    DEV: true,
  },
  writable: true,
});
