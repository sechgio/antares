import { fetchJson, httpsUrl } from '../radio/core';
import type { StreamItem, StreamSource, StreamTrack } from './core';

const API = 'https://api.jamendo.com/v3.0';
const PAGE = 'https://www.jamendo.com';

const clientId = () => (import.meta.env.VITE_JAMENDO_CLIENT_ID ?? '').trim();
export const keyMissing = (): boolean => !clientId();

interface RawJamendoTrack {
  id?: number | string;
  name?: string;
  artist_name?: string;
  duration?: number;
  audio?: string;
  shareurl?: string;
}

export function toTrack(raw: RawJamendoTrack | null | undefined): StreamTrack | null {
  const id = raw?.id;
  if (id === undefined || id === null || typeof raw?.name !== 'string' || !raw.name) return null;
  const stream = httpsUrl(raw.audio);
  if (!stream) return null;
  return {
    id: String(id),
    title: raw.name,
    artist: typeof raw.artist_name === 'string' ? raw.artist_name : '',
    duration: Number.isFinite(raw.duration) ? Math.max(0, Math.trunc(raw.duration as number)) : 0,
    stream,
    url: httpsUrl(raw.shareurl) ?? `${PAGE}/track/${id}`,
  };
}

async function requestTracks(params: string, signal?: AbortSignal): Promise<StreamTrack[]> {
  const id = clientId();
  if (!id) throw new Error('jamendo-client-id-missing');
  const payload = (await fetchJson(
    `${API}/tracks/?client_id=${encodeURIComponent(id)}&format=json&limit=20&type=single+albumtrack&${params}`,
    signal,
  )) as { headers?: { status?: string }; results?: RawJamendoTrack[] };
  if (payload?.headers?.status !== 'success') throw new Error('jamendo-request-failed');
  return (payload.results ?? [])
    .map(toTrack)
    .filter((item): item is StreamTrack => item !== null);
}

export const jamendoSource: StreamSource = {
  id: 'jamendo',
  name: 'Jamendo',
  accent: '#f2a50f',
  strings: {
    browse: 'Abrir panel de Jamendo',
    trending: 'Populares',
    search: 'Buscar en Jamendo…',
    open: 'Abrir en Jamendo',
    keyHint: 'Añade VITE_JAMENDO_CLIENT_ID en frontend/.env.local (gratis en devportal.jamendo.com) y reinicia.',
  },
  keyMissing,
  listIsQueue: true,
  browse: (signal) => requestTracks('order=popularity_week', signal),
  search: (query, signal) => requestTracks(`search=${encodeURIComponent(query)}`, signal),
  resolve: async (item: StreamItem, list: readonly StreamItem[]) => ({
    tracks: list.map((entry) => entry as StreamTrack),
    index: Math.max(
      0,
      list.findIndex((entry) => entry.id === item.id),
    ),
  }),
};
