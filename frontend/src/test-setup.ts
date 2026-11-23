import '@testing-library/jest-dom';
import { cleanup, configure, getConfig } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

const testGlobals = globalThis as typeof globalThis & {
  __baseAsyncWrapper?: ReturnType<typeof getConfig>['asyncWrapper'];
  setImmediate?: (callback: () => void) => unknown;
};
testGlobals.__baseAsyncWrapper ??= getConfig().asyncWrapper;
const baseAsyncWrapper = testGlobals.__baseAsyncWrapper;
const realSetImmediate = testGlobals.setImmediate;
if (typeof realSetImmediate === 'function') {
  configure({
    asyncWrapper: (cb) =>
      baseAsyncWrapper(async () => {
        const result = await cb();
        await new Promise<void>((resolve) => realSetImmediate(() => resolve()));
        return result;
      }),
  });
}

async function resetI18nLanguage() {
  const current = (await import('./i18n')).default;
  await current.changeLanguage('es');
}

afterEach(async () => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  await resetI18nLanguage();
});

if (typeof window !== 'undefined') {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(String(key)) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      map.set(String(key), String(value));
    },
  };
  for (const target of [globalThis, window]) {
    let ok = false;
    try {
      ok = typeof target.localStorage === 'object';
    } catch {
      ok = false;
    }
    if (!ok) {
      Object.defineProperty(target, 'localStorage', { value: store, configurable: true, writable: true });
    }
  }
}

if (typeof globalThis.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = target.getBoundingClientRect?.() ?? {
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver !== 'function') {
  class IntersectionObserverStub {
    callback: IntersectionObserverCallback;
    root = null;
    rootMargin = '0px';
    thresholds = [0];
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
  if (typeof window !== 'undefined') {
    window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
  }
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
  name: 'Precision Linear',
  bg: '#0A0D12',
  bg_secondary: '#111522',
  fg: '#FFFFFF',
  fg_muted: '#7C8494',
  accent: '#5E6AD2',
  accent_light: '#8B93FF',
  accent_hover: '#4D57BE',
  accent_dark: '#343B8F',
  border: '#27304E',
  blue_hover: '#22C7A9',
  error: '#EB001B',
  warning: '#F79E1B',
  success: '#76b900',
  orange: '#8B93FF',
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      invoke: async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'version') return { version: '0.10.6' };
        if (method === 'formats') return { formats: ['JPEG', 'PNG', 'WEBP'] };
        if (method === 'formatos_list') return { formats: [] };
        if (method === 'db_fields')
          return { fields: [{ name: 'codigo', type: 'string', required: true, unique: false }] };
        if (method === 'theme_get') return defaultTheme;
        if (method === 'theme_presets') return { presets: ['Precision Linear'] };
        if (method === 'history_list') return { runs: [] };
        if (method === 'technical_reports_list') return { reports: [] };
        if (method === 'templates_list') return { templates: [] };
        throw new Error(
          `IPC method not allowed: ${method} (test stub — añade el método al stub si el test lo necesita)`,
        );
      },
      onNotify: () => () => {},
      minimizeWindow: async () => ({}),
      maximizeWindow: async () => ({}),
      closeWindow: async () => ({}),
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

const baselineElectronApi = typeof window !== 'undefined' ? window.electronAPI : undefined;
const baselineResizeObserver = globalThis.ResizeObserver;
const baselineIntersectionObserver = globalThis.IntersectionObserver;
const baselineWebSocket = globalThis.WebSocket;
const baselineMatchMedia = typeof window !== 'undefined' ? window.matchMedia : undefined;
const baselineCreateObjectURL = URL.createObjectURL?.bind(URL);
const baselineRevokeObjectURL = URL.revokeObjectURL?.bind(URL);

const DOM_PROTO_KEYS = [
  'getBoundingClientRect',
  'offsetHeight',
  'offsetWidth',
  'offsetLeft',
  'offsetTop',
  'clientHeight',
  'clientWidth',
  'scrollIntoView',
  'scrollTo',
  'scrollBy',
  'scroll',
];
const domProtoBaselines: Array<{ proto: object; key: string; desc?: PropertyDescriptor }> = [];
if (typeof Element !== 'undefined' && typeof HTMLElement !== 'undefined') {
  for (const proto of [Element.prototype, HTMLElement.prototype]) {
    for (const key of DOM_PROTO_KEYS) {
      domProtoBaselines.push({ proto, key, desc: Object.getOwnPropertyDescriptor(proto, key) });
    }
  }
}
const windowMetricBaselines: Array<{ key: string; desc?: PropertyDescriptor }> = [];
if (typeof window !== 'undefined') {
  for (const key of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio']) {
    windowMetricBaselines.push({ key, desc: Object.getOwnPropertyDescriptor(window, key) });
  }
}

function restoreDomBaselines() {
  for (const { proto, key, desc } of domProtoBaselines) {
    if (desc) {
      Object.defineProperty(proto, key, desc);
    } else {
      delete (proto as Record<string, unknown>)[key];
    }
  }
  if (typeof window !== 'undefined') {
    for (const { key, desc } of windowMetricBaselines) {
      if (desc) {
        Object.defineProperty(window, key, desc);
      } else {
        delete (window as unknown as Record<string, unknown>)[key];
      }
    }
  }
}

afterAll(async () => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  restoreDomBaselines();

  globalThis.ResizeObserver = baselineResizeObserver;
  globalThis.IntersectionObserver = baselineIntersectionObserver;
  globalThis.WebSocket = baselineWebSocket;
  URL.createObjectURL = baselineCreateObjectURL as typeof URL.createObjectURL;
  URL.revokeObjectURL = baselineRevokeObjectURL as typeof URL.revokeObjectURL;
  if (typeof window !== 'undefined') {
    window.IntersectionObserver = baselineIntersectionObserver;
    if (baselineMatchMedia) window.matchMedia = baselineMatchMedia;
    window.electronAPI = baselineElectronApi;
    if (typeof localStorage !== 'undefined') localStorage.clear();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    for (const attr of [...document.documentElement.attributes]) {
      if (attr.name.startsWith('data-')) document.documentElement.removeAttribute(attr.name);
    }
    window.history.replaceState(null, '', '/');
  }
  await resetI18nLanguage();
});
