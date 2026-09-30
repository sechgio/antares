import { fetchJson, httpsUrl, atom, openExternal, useValue } from '../radio/core';
import type { Atom } from '../radio/core';

export { atom, openExternal, useValue };
export type { Atom };

export const T = {
  audius: 'Audius',
  browse: 'Abrir panel de Audius',
  play: 'Reproducir',
  pause: 'Pausar',
  next: 'Siguiente',
  previous: 'Anterior',
  volume: 'Volumen',
  mute: 'Silenciar',
  unmute: 'Quitar silencio',
  search: 'Buscar en Audius…',
  searching: 'Buscando',
  loading: 'Cargando pistas',
  trending: 'En tendencia',
  results: 'Resultados',
  empty: 'Nada por aquí',
  searchError: 'La búsqueda falló. Reintenta.',
  noResults: 'Sin resultados',
  error: 'No se pudo reproducir esta pista',
  open: 'Abrir en Audius',
  pauseTrack: 'Pausar',
  playTrack: 'Reproducir',
} as const;

export interface AudiusTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
}

interface RawTrack {
  id?: string;
  title?: string;
  duration?: number;
  permalink?: string;
  user?: { name?: string };
}

const APP_NAME = 'antares';
const HOST_FALLBACK = 'https://api.audius.co';
const TRENDING_TTL_MS = 60_000;

let hostPromise: Promise<string> | null = null;
let resolvedHost: string | null = null;
let trendingCache: { at: number; tracks: AudiusTrack[] } | null = null;

async function resolveHost(signal?: AbortSignal): Promise<string> {
  if (!hostPromise) {
    hostPromise = (async () => {
      try {
        const payload = (await fetchJson(`https://api.audius.co`, undefined)) as { data?: unknown };
        const first = Array.isArray(payload?.data) ? payload.data[0] : null;
        // `httpsUrl` devuelve `href`, que trae `/` final: concatenarlo con `/v1/...`
        // produce `//v1/...` y Audius responde 404 en /v1/tracks/search.
        const resolved = typeof first === 'string' ? httpsUrl(first) : null;
        resolvedHost = resolved ? resolved.replace(/\/$/, '') : HOST_FALLBACK;
        return resolvedHost;
      } catch {
        hostPromise = null;
        return HOST_FALLBACK;
      }
    })();
  }
  return hostPromise.then((host) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return host;
  });
}

export function toTrack(raw: RawTrack | null | undefined): AudiusTrack | null {
  if (typeof raw?.id !== 'string' || !raw.id || typeof raw.title !== 'string' || !raw.title) {
    return null;
  }
  const path = typeof raw.permalink === 'string' ? raw.permalink : '';
  const url = httpsUrl(`https://audius.co${path}`) ?? 'https://audius.co/';
  return {
    id: raw.id,
    title: raw.title,
    artist: typeof raw.user?.name === 'string' ? raw.user.name : '',
    duration: Number.isFinite(raw.duration) ? Math.max(0, Math.trunc(raw.duration as number)) : 0,
    url,
  };
}

function toTracks(payload: unknown): AudiusTrack[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((item) => toTrack(item as RawTrack)).filter((item): item is AudiusTrack => item !== null);
}

export function streamUrl(track: AudiusTrack): string {
  return `${resolvedHost ?? HOST_FALLBACK}/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=${APP_NAME}`;
}

export async function fetchTrending(signal?: AbortSignal): Promise<AudiusTrack[]> {
  if (trendingCache && Date.now() - trendingCache.at < TRENDING_TTL_MS) return trendingCache.tracks;
  const host = await resolveHost(signal);
  const tracks = toTracks(
    await fetchJson(`${host}/v1/tracks/trending?app_name=${APP_NAME}&limit=20`, signal),
  );
  trendingCache = { at: Date.now(), tracks };
  return tracks;
}

export async function searchTracks(query: string, signal?: AbortSignal): Promise<AudiusTrack[]> {
  const host = await resolveHost(signal);
  return toTracks(
    await fetchJson(
      `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}&limit=20`,
      signal,
    ),
  );
}

export function resetAudiusForTests(): void {
  hostPromise = null;
  resolvedHost = null;
  trendingCache = null;
}
