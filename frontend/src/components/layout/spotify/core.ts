import { api, onNotify, type SpotifyAuthStatus } from '../../../api';
import { atom, useValue, openExternal } from '../radio/core';
import type { Atom } from '../radio/core';

export { useValue, openExternal };

export const T = {
  spotify: 'Spotify',
  browse: 'Abrir panel de Spotify',
  play: 'Reproducir',
  pause: 'Pausar',
  next: 'Siguiente',
  previous: 'Anterior',
  shuffleOn: 'Aleatorio activado',
  shuffleOff: 'Aleatorio desactivado',
  repeatTrack: 'Repetir pista',
  repeatContext: 'Repetir contexto',
  repeatOff: 'Repetición desactivada',
  volume: 'Volumen',
  search: 'Buscar en Spotify…',
  searching: 'Buscando',
  connect: 'Conectar con Spotify',
  disconnect: 'Desconectar',
  cancelAuth: 'Cancelar',
  saveConfig: 'Guardar',
  editConfig: 'Editar',
  devices: 'Dispositivos',
  queue: 'Cola',
  playlists: 'Playlists',
  saved: 'Guardados',
  searchTab: 'Buscar',
  transferTo: 'Reproducir aquí',
  noActive: 'Sin reproducción activa',
  openSpotifyHint: 'Abre Spotify en un dispositivo para controlarlo',
  noResults: 'Sin resultados',
  searchError: 'La búsqueda falló. Reintenta.',
  configTitle: 'Client ID de Spotify',
  configHint:
    'Crea tu app en developer.spotify.com/dashboard y registra la redirect URI que se muestra al conectar.',
  redirectUri: 'Redirect URI (opcional)',
  redirectUriPlaceholder: 'http://127.0.0.1:43830/callback',
  awaiting: 'Autoriza en el navegador…',
  premiumHint: 'El control de reproducción requiere Spotify Premium',
  queueAdd: 'Añadir a la cola',
  queueAdded: 'Añadido a la cola',
  saveToLibrary: 'Guardar en tu biblioteca',
  removeFromLibrary: 'Quitar de tu biblioteca',
  savedToLibrary: 'Guardado',
  playContext: 'Reproducir',
  emptyQueue: 'La cola está vacía',
  emptyList: 'Nada por aquí',
  refresh: 'Actualizar',
  authError: 'No se pudo conectar con Spotify',
  configured: 'Configurado',
  account: 'Cuenta',
} as const;

export type SessionState = 'unconfigured' | 'unauthenticated' | 'ready';

export interface TrackLite {
  id?: string;
  uri?: string;
  name: string;
  artists: string;
  album: string;
  duration_ms?: number;
}

export interface DeviceLite {
  id?: string;
  name: string;
  type?: string;
  is_active?: boolean;
  volume_percent?: number;
}

export interface PlaybackSnapshot {
  empty: boolean;
  is_playing: boolean;
  track?: TrackLite;
  progress_ms?: number;
  duration_ms?: number;
  fetched_at: number;
  shuffle_state?: boolean;
  repeat_state?: string;
  device?: DeviceLite;
}

interface RawArtist { name?: string }
interface RawTrack {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: RawArtist[];
  album?: { name?: string };
}

function _track(raw: RawTrack | undefined | null): TrackLite | undefined {
  if (!raw?.name) return undefined;
  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.name,
    artists: (raw.artists || []).map((a) => a?.name).filter(Boolean).join(', '),
    album: raw.album?.name || '',
    duration_ms: raw.duration_ms,
  };
}

function _snapshot(payload: Record<string, unknown> | null | undefined): PlaybackSnapshot {
  const base: PlaybackSnapshot = { empty: true, is_playing: false, fetched_at: Date.now() };
  if (!payload || typeof payload !== 'object') return base;
  const item = payload.item as RawTrack | undefined;
  if (!item) return base;
  const device = payload.device as DeviceLite | undefined;
  return {
    empty: false,
    is_playing: payload.is_playing === true,
    track: _track(item),
    progress_ms: typeof payload.progress_ms === 'number' ? payload.progress_ms : undefined,
    duration_ms: item.duration_ms,
    fetched_at: Date.now(),
    shuffle_state: payload.shuffle_state === true,
    repeat_state: typeof payload.repeat_state === 'string' ? payload.repeat_state : undefined,
    device: device
      ? {
          id: device.id,
          name: device.name,
          type: device.type,
          is_active: device.is_active,
          volume_percent: device.volume_percent,
        }
      : undefined,
  };
}

const POLL_MS = 8_000;
const POST_COMMAND_REFRESH_MS = 450;

export interface SpotifyController {
  session: Atom<SessionState>;
  account: Atom<SpotifyAuthStatus | null>;
  playback: Atom<PlaybackSnapshot>;
  busy: Atom<boolean>;
  lastError: Atom<string>;
  refreshSession(): Promise<void>;
  poll(): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  playContext(context_uri: string): Promise<void>;
  playUris(uris: string[]): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  cycleRepeat(): Promise<void>;
  setVolume(percent: number): Promise<void>;
  transfer(device_id: string): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): void;
}

export function createSpotifyController(): SpotifyController {
  const session = atom<SessionState>('unconfigured');
  const account = atom<SpotifyAuthStatus | null>(null);
  const playback = atom<PlaybackSnapshot>({ empty: true, is_playing: false, fetched_at: 0 });
  const busy = atom(false);
  const lastError = atom('');

  let disposed = false;
  let timer: number | undefined;

  const setError = (err: unknown) => {
    lastError.set(err instanceof Error ? err.message : String(err));
  };

  async function refreshSession() {
    try {
      const cfg = await api.spotifyOauthConfigStatus();
      if (!cfg.configured) {
        session.set('unconfigured');
        account.set(null);
        return;
      }
      const auth = await api.spotifyAuthStatus();
      if (!auth.authenticated) {
        session.set('unauthenticated');
        account.set(null);
        return;
      }
      account.set(auth);
      if (session.get() !== 'ready') session.set('ready');
      schedulePoll();
    } catch (err) {
      setError(err);
      session.set('unauthenticated');
    }
  }

  async function poll() {
    if (disposed || session.get() !== 'ready') return;
    try {
      const payload = await api.spotifyPlayback({ action: 'get_state' });
      playback.set(_snapshot(payload));
      lastError.set('');
    } catch (err) {
      setError(err);
    }
  }

  function schedulePoll() {
    window.clearTimeout(timer);
    // Sin sesión lista no hay nada que sondear: la cadena se rearma cuando el
    // estado pasa a 'ready' (refreshSession o el notify de auth).
    if (disposed || session.get() !== 'ready') return;
    timer = window.setTimeout(async () => {
      await poll();
      schedulePoll();
    }, POLL_MS);
  }

  async function _run(action: () => Promise<unknown>) {
    if (busy.get()) return;
    busy.set(true);
    try {
      await action();
      window.setTimeout(() => void poll(), POST_COMMAND_REFRESH_MS);
    } catch (err) {
      setError(err);
      void poll();
    } finally {
      busy.set(false);
    }
  }

  const unsubNotify = onNotify((method, params) => {
    if (method === 'spotify.auth.complete') {
      const p = params as SpotifyAuthStatus | undefined;
      if (p?.authenticated) {
        account.set(p);
        session.set('ready');
        lastError.set('');
        void poll();
        schedulePoll();
      } else {
        session.set('unauthenticated');
      }
    }
    if (method === 'spotify.auth.error') {
      const p = params as { message?: string } | undefined;
      lastError.set(p?.message || T.authError);
    }
  });

  void refreshSession().then(() => {
    if (!disposed && session.get() === 'ready') void poll();
  });

  return {
    session,
    account,
    playback,
    busy,
    lastError,
    refreshSession,
    poll,
    toggle: () => _run(async () => {
      const snap = playback.get();
      await api.spotifyPlayback({ action: snap.is_playing ? 'pause' : 'play' });
    }),
    next: () => _run(() => api.spotifyPlayback({ action: 'next' })),
    previous: () => _run(() => api.spotifyPlayback({ action: 'previous' })),
    playContext: (context_uri) => _run(() => api.spotifyPlayback({ action: 'play', context_uri })),
    playUris: (uris) => _run(() => api.spotifyPlayback({ action: 'play', uris })),
    setShuffle: (on) => _run(() => api.spotifyPlayback({ action: 'set_shuffle', state: on })),
    cycleRepeat: () => _run(async () => {
      const order = ['off', 'context', 'track'];
      const current = playback.get().repeat_state || 'off';
      const nextState = order[(order.indexOf(current) + 1) % order.length];
      await api.spotifyPlayback({ action: 'set_repeat', state: nextState });
    }),
    setVolume: (percent) => _run(() => api.spotifyPlayback({ action: 'set_volume', volume_percent: percent })),
    transfer: (device_id) => _run(() => api.spotifyDevices({ action: 'transfer', device_id, play: true })),
    disconnect: async () => {
      await api.spotifyAuthRevoke();
      account.set(null);
      playback.set({ empty: true, is_playing: false, fetched_at: 0 });
      session.set('unauthenticated');
    },
    dispose: () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubNotify();
    },
  };
}
