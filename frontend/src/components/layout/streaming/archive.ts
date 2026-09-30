import { fetchJson } from '../radio/core';
import type { StreamItem, StreamSource, StreamTrack } from './core';

const API = 'https://archive.org';
const COLLECTIONS = '(etree OR netlabels OR freemusicarchive)';

interface RawDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
}

interface RawFile {
  name?: string;
  format?: string;
  length?: number | string;
  title?: string;
  artist?: string;
  creator?: string;
  track?: number | string;
}

export function toItem(raw: RawDoc | null | undefined): StreamItem | null {
  if (typeof raw?.identifier !== 'string' || !raw.identifier) return null;
  const creator = Array.isArray(raw.creator) ? raw.creator[0] : raw.creator;
  return {
    id: raw.identifier,
    title: typeof raw.title === 'string' && raw.title ? raw.title : raw.identifier,
    artist: typeof creator === 'string' ? creator : '',
    duration: 0,
  };
}

const AUDIO_FORMAT = (format: string | undefined): boolean =>
  typeof format === 'string' &&
  (format === 'VBR MP3' || format === 'Ogg Vorbis' || /^(\d+Kbps )?MP3$/.test(format));

export function parseLength(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  if (text.includes(':')) {
    let seconds = 0;
    for (const part of text.split(':')) {
      const n = Number(part);
      if (!Number.isFinite(n)) return 0;
      seconds = seconds * 60 + n;
    }
    return seconds;
  }
  const n = Number(text);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/* IA publica cada tema en varios formatos (VBR MP3 + Ogg Vorbis): agrupar por
   número/título de pista y quedarse con la variante MP3 evita duplicar la cola. */
function fileKey(file: RawFile): string {
  if (file.track !== undefined && file.track !== '') return `t:${file.track}`;
  const base = file.title ?? file.name ?? '';
  return base.replace(/\.[a-z0-9]+$/i, '');
}

export function toTracks(item: StreamItem, files: RawFile[] | undefined): StreamTrack[] {
  const playable = (files ?? []).filter(
    (file) => AUDIO_FORMAT(file.format) && typeof file.name === 'string' && file.name,
  );
  const byKey = new Map<string, RawFile>();
  for (const file of playable) {
    const key = fileKey(file);
    const prev = byKey.get(key);
    const mp3 = (file.format ?? '').includes('MP3');
    const prevMp3 = prev ? (prev.format ?? '').includes('MP3') : false;
    if (!prev || (mp3 && !prevMp3)) byKey.set(key, file);
  }
  return [...byKey.values()].map((file) => {
    const name = file.name as string;
    const artist =
      typeof file.artist === 'string' && file.artist
        ? file.artist
        : typeof file.creator === 'string' && file.creator
          ? file.creator
          : item.artist;
    return {
      id: `${item.id}/${name}`,
      itemId: item.id,
      title: typeof file.title === 'string' && file.title ? file.title : name,
      artist,
      duration: parseLength(file.length),
      stream: `${API}/download/${encodeURIComponent(item.id)}/${encodeURIComponent(name)}`,
      url: `${API}/details/${encodeURIComponent(item.id)}`,
    };
  });
}

export async function fetchItems(query: string, signal?: AbortSignal): Promise<StreamItem[]> {
  const params = `q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=20&output=json&sort[]=downloads+desc`;
  const payload = (await fetchJson(`${API}/advancedsearch.php?${params}`, signal)) as {
    response?: { docs?: RawDoc[] };
  };
  return (payload.response?.docs ?? []).map(toItem).filter((i): i is StreamItem => i !== null);
}

export async function fetchItemTracks(
  item: StreamItem,
  signal?: AbortSignal,
): Promise<StreamTrack[]> {
  const payload = (await fetchJson(`${API}/metadata/${encodeURIComponent(item.id)}`, signal)) as {
    files?: RawFile[];
  };
  return toTracks(item, payload.files);
}

/* Lucene: el texto libre del usuario no puede llevar operadores sin cerrar. */
const sanitize = (text: string): string =>
  text
    .replace(/[+\-!(){}[\]^"~*?:\\/|&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const browseQuery = `mediatype:audio AND collection:${COLLECTIONS}`;

export const archiveSource: StreamSource = {
  id: 'archive',
  name: 'Archive',
  accent: '#c9a86a',
  strings: {
    browse: 'Abrir panel de Archive',
    trending: 'Más descargados',
    search: 'Buscar en Archive…',
    open: 'Abrir en Internet Archive',
  },
  browse: (signal) => fetchItems(browseQuery, signal),
  search: (query, signal) => {
    const text = sanitize(query);
    return fetchItems(text ? `${text} AND ${browseQuery}` : browseQuery, signal);
  },
  resolve: async (item: StreamItem, _list, signal) => ({
    tracks: await fetchItemTracks(item, signal),
    index: 0,
  }),
};
