import { fetchJson, httpsUrl, storage, timeoutSignal } from './core';

export interface IcecastSource {
  title?: string;
  artist?: string;
  listenurl?: string;
  metadata?: { artist?: string };
}

export interface IcecastStatus {
  icestats?: { source?: IcecastSource | IcecastSource[] };
}

export function trackCredit(source: IcecastSource | null): { artist: string; title: string } {
  const raw = typeof source?.title === 'string' ? source.title.trim() : '';
  const explicit = source?.artist || source?.metadata?.artist;
  const parts = raw.match(/^(.+?)\s[-–—]\s(.+)$/);
  const artist = typeof explicit === 'string' ? explicit.trim() : parts?.[1].trim() || '';
  const title = parts && parts[1].trim() === artist ? parts[2].trim() : raw;
  return { artist: raw ? artist : '', title };
}

interface LockManagerLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}

async function artistRequest(path: string, signal?: AbortSignal): Promise<unknown> {
  const run = async () => {
    const delayMs = Math.max(0, 1100 - (Date.now() - storage.get('artistRequestAt', 0)));
    if (delayMs) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    signal?.throwIfAborted();
    storage.set('artistRequestAt', Date.now());
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      signal: timeoutSignal(signal, 15000),
      credentials: 'omit',
      headers: { 'User-Agent': 'AntaresRadio/1.0' },
    });
    if (!response.ok) throw new Error(`Artist lookup: HTTP ${response.status}`);
    return response.json();
  };
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return locks ? locks.request('antares:radio:artist-lookup', { signal }, run) : run();
}

export interface MusicBrainzRelation {
  ended?: boolean;
  type?: string;
  url?: { resource?: string };
}

export function artistProfile(relations: MusicBrainzRelation[] | undefined): string | null {
  const links = (relations ?? [])
    .filter((item) => !item.ended)
    .flatMap((item) => {
      const href = httpsUrl(item.url?.resource);
      if (!href) return [];
      const url = new URL(href);
      if (url.hostname === 'open.spotify.com' && /^\/artist\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname)) {
        return [{ href, rank: 0 }];
      }
      if (item.type === 'bandcamp' && /^[^.]+\.bandcamp\.com$/.test(url.hostname) && url.pathname === '/') {
        return [{ href, rank: 1 }];
      }
      if (
        item.type === 'official homepage' &&
        !['open.spotify.com', 'bandcamp.com'].includes(url.hostname)
      ) {
        return [{ href, rank: 2 }];
      }
      return [];
    });
  return links.sort((a, b) => a.rank - b.rank)[0]?.href ?? null;
}

function normalizedArtist(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

interface AppleSearchResult {
  wrapperType?: string;
  artistName?: string;
  artistLinkUrl?: string;
}

interface MusicBrainzArtist {
  id?: string;
  name?: string;
  score?: number;
}

export async function resolveArtist(
  artist: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const params = new URLSearchParams({ term: artist, entity: 'musicArtist', limit: '10' });
  try {
    const result = (await fetchJson(`https://itunes.apple.com/search?${params}`, signal)) as {
      results?: AppleSearchResult[];
    };
    const matches = (result.results ?? []).filter(
      (item) =>
        item.wrapperType === 'artist' &&
        normalizedArtist(item.artistName ?? '') === normalizedArtist(artist),
    );
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      const href = httpsUrl(matches[0].artistLinkUrl);
      if (href) {
        const url = new URL(href);
        if (url.hostname === 'music.apple.com' && /^\/[a-z]{2}\/artist\/[^/]+\/\d+$/.test(url.pathname)) {
          url.search = '';
          return url.href;
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return resolveMusicBrainzArtist(artist, signal);
}

async function resolveMusicBrainzArtist(
  artist: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const escaped = artist.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, '\\$&');
  const params = new URLSearchParams({ query: `artist:"${escaped}"`, fmt: 'json', limit: '5' });
  const result = (await artistRequest(`artist/?${params}`, signal)) as {
    artists?: MusicBrainzArtist[];
  };
  const matches = (result.artists ?? []).filter(
    (item) => normalizedArtist(item.name ?? '') === normalizedArtist(artist),
  );
  if (matches.length !== 1 || matches[0].score !== 100 || result.artists?.length === 5) return null;
  const id = matches[0].id;
  if (!id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) return null;
  const profile = (await artistRequest(`artist/${id}?inc=url-rels&fmt=json`, signal)) as {
    relations?: MusicBrainzRelation[];
  };
  return artistProfile(profile.relations);
}
