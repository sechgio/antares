import { useSyncExternalStore } from 'react';

export interface Station {
  id: string;
  name: string;
  url: string;
  description?: string;
  provider?: string;
  homepage?: string | null;
}

export type PlayerStatus = 'paused' | 'connecting' | 'live' | 'error' | 'elsewhere';
export type MeterMode = 'levels' | 'activity';

export const NIGHTRIDE = 'https://stream.nightride.fm/';
export const PRESETS: Station[] = [
  { id: 'chillsynth', name: 'Chillsynth', description: 'Enfoque suave · sintes cálidos', provider: 'Nightride FM', url: `${NIGHTRIDE}chillsynth.mp3`, homepage: 'https://nightride.fm/?station=chillsynth' },
  { id: 'nightride', name: 'Nightride', description: 'Synthwave · madrugada', provider: 'Nightride FM', url: `${NIGHTRIDE}nightride.mp3`, homepage: 'https://nightride.fm/' },
  { id: 'darksynth', name: 'Darksynth', description: 'Electrónica oscura · alta energía', provider: 'Nightride FM', url: `${NIGHTRIDE}darksynth.mp3`, homepage: 'https://nightride.fm/?station=darksynth' },
  { id: 'spacesynth', name: 'Spacesynth', description: 'Sintes cósmicos · futuros retro', provider: 'Nightride FM', url: `${NIGHTRIDE}spacesynth.mp3`, homepage: 'https://nightride.fm/?station=spacesynth' },
  { id: 'paradise-main', name: 'Main Mix', description: 'Ecléctico · selección humana', provider: 'Radio Paradise', url: 'https://stream.radioparadise.com/aac-128', homepage: 'https://radioparadise.com/' },
  { id: 'paradise-mellow', name: 'Mellow Mix', description: 'Un ritmo más calmado', provider: 'Radio Paradise', url: 'https://stream.radioparadise.com/mellow-flac', homepage: 'https://radioparadise.com/' },
  { id: 'eve-radio', name: 'EVE Radio', description: 'GamingNow · radio de la comunidad EVE', provider: 'GamingNow', url: 'https://media01.gamingnow.net:8010/erweb.mp3', homepage: 'https://gamingnow.net/eve-radio/' },
];

export const T = {
  radio: 'Radio',
  browse: 'Elige una estación',
  play: 'Reproducir radio',
  pause: 'Pausar radio',
  next: 'Siguiente estación',
  paused: 'En pausa',
  connecting: 'Conectando',
  error: 'Stream no disponible',
  elsewhere: 'En pausa — sonando en otra ventana',
  retry: 'Reintentar',
  search: 'Busca una estación…',
  volume: 'Volumen',
  audioOnly: 'Reproduciendo · visualizador no disponible',
  mute: 'Silenciar radio',
  unmute: 'Quitar silencio',
  save: 'Fijar estación',
  unsave: 'Quitar fijación',
  visit: 'Visitar sitio de la estación',
  artistProfile: 'Visitar perfil del artista',
  noResults: 'No se encontraron estaciones',
  searchError: 'La búsqueda no está disponible. Tus estaciones fijadas siguen funcionando.',
  searching: 'Buscando estaciones',
  streamError: 'No se pudo conectar con este stream. Reintenta o elige otra estación.',
} as const;

export interface Atom<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useValue<T>(store: Atom<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function createBudgetedLoop(
  tick: () => void,
  { fps, idleWhen }: { fps: number; idleWhen?: () => boolean },
) {
  const run = () => {
    if (!idleWhen?.()) tick();
  };
  const id = window.setInterval(run, 1000 / fps);
  return { wake: run, dispose: () => window.clearInterval(id) };
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(`antares.radio.${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(`antares.radio.${key}`, JSON.stringify(value));
    } catch {}
  },
};

export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function timeoutSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = window.setTimeout(
    () => ctrl.abort(new DOMException('Timed out', 'TimeoutError')),
    ms,
  );
  const onAbort = () => {
    window.clearTimeout(timer);
    ctrl.abort(parent?.reason);
  };
  if (parent) {
    if (parent.aborted) {
      window.clearTimeout(timer);
      ctrl.abort(parent.reason);
    } else {
      parent.addEventListener('abort', onAbort, { once: true });
    }
  }
  return ctrl.signal;
}

export function httpsUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function validStation(value: unknown): value is Station {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Station>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    httpsUrl(candidate.url) !== null
  );
}

export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal: timeoutSignal(signal, 10000),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

interface RadioBrowserStation {
  stationuuid?: string;
  name?: string;
  url_resolved?: string;
  homepage?: string;
  hls?: boolean;
  tags?: string;
}

let directoryServers = ['https://de1.api.radio-browser.info'];
let directoryDiscovered = false;

export async function searchStations(text: string, signal?: AbortSignal): Promise<Station[]> {
  if (!directoryDiscovered) {
    try {
      const servers = (await fetchJson(
        `${directoryServers[0]}/json/servers`,
        signal,
      )) as Array<{ name?: string }>;
      const hosts = [
        ...new Set(
          servers
            .map((server) => server.name)
            .filter((name): name is string =>
              typeof name === 'string' && /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(name),
            ),
        ),
      ];
      if (hosts.length) {
        directoryServers = hosts
          .map((name) => `https://${name}`)
          .sort(() => Math.random() - 0.5);
      }
      directoryDiscovered = true;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  const params = new URLSearchParams({
    name: text,
    limit: '60',
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
  });
  for (const server of directoryServers.slice(0, 3)) {
    try {
      const rows = (await fetchJson(
        `${server}/json/stations/search?${params}`,
        signal,
      )) as RadioBrowserStation[];
      const seen = new Set<string>();
      return rows.flatMap((row) => {
        const url = httpsUrl(row.url_resolved);
        if (!url || !row.stationuuid || !row.name || row.hls || seen.has(url)) return [];
        seen.add(url);
        return [
          {
            id: row.stationuuid,
            name: row.name.trim(),
            url,
            provider: 'Radio Browser',
            description: row.tags?.split(',').slice(0, 2).join(' · ') || '',
            homepage: httpsUrl(row.homepage),
          },
        ];
      });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error('Directory unavailable');
}

export function sameStation(a: Station, b: Station): boolean {
  return a.id === b.id || a.url === b.url;
}

export function uniqueStations(items: Station[]): Station[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  return items.filter((item) => {
    if (ids.has(item.id) || urls.has(item.url)) return false;
    ids.add(item.id);
    urls.add(item.url);
    return true;
  });
}
