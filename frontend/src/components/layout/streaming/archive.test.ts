import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveSource,
  fetchItems,
  fetchItemTracks,
  parseLength,
  toItem,
  toTracks,
} from './archive';
import type { StreamItem } from './core';

const json = (data: unknown) => ({ ok: true, json: async () => data });

const ITEM: StreamItem = { id: 'show-1', title: 'Show', artist: 'Banda', duration: 0 };

const FILES = [
  { name: '01-Intro.mp3', format: 'VBR MP3', length: '00:53', title: 'Intro', track: 1 },
  { name: '01-Intro.ogg', format: 'Ogg Vorbis', length: '00:53', title: 'Intro', track: 1 },
  { name: '02 Tema.mp3', format: 'VBR MP3', length: 342, title: 'Tema Dos', track: 2, artist: 'Otro' },
  { name: 'cover.jpg', format: 'JPEG' },
  { name: 'notes.txt', format: 'Text' },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Archive mapping', () => {
  it('maps search docs to items and drops malformed entries', () => {
    expect(toItem({ identifier: 'x-1', title: 'Disco', creator: 'Artista' })).toEqual({
      id: 'x-1',
      title: 'Disco',
      artist: 'Artista',
      duration: 0,
    });
    expect(toItem({ identifier: 'x-2', creator: ['A', 'B'] })!.artist).toBe('A');
    expect(toItem({ identifier: 'x-3' })!.title).toBe('x-3');
    expect(toItem({ title: 'sin id' })).toBeNull();
    expect(toItem(null)).toBeNull();
  });

  it('parses file lengths in mm:ss, hh:mm:ss and numeric seconds', () => {
    expect(parseLength('05:42')).toBe(342);
    expect(parseLength('1:02:03')).toBe(3723);
    expect(parseLength(305.4)).toBe(305);
    expect(parseLength('305')).toBe(305);
    expect(parseLength('roto')).toBe(0);
    expect(parseLength(undefined)).toBe(0);
  });

  it('keeps playable formats only and prefers the mp3 variant per track', () => {
    const tracks = toTracks(ITEM, FILES);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: 'show-1/01-Intro.mp3',
      itemId: 'show-1',
      title: 'Intro',
      duration: 53,
      stream: 'https://archive.org/download/show-1/01-Intro.mp3',
      url: 'https://archive.org/details/show-1',
    });
    expect(tracks[1]).toMatchObject({
      id: 'show-1/02 Tema.mp3',
      artist: 'Otro',
      duration: 342,
    });
    expect(tracks[1].stream).toBe('https://archive.org/download/show-1/02%20Tema.mp3');
    expect(toTracks(ITEM, [])).toEqual([]);
  });
});

describe('Archive API', () => {
  it('builds the advancedsearch query and maps docs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json({ response: { docs: [{ identifier: 'x-1', title: 'Disco', creator: 'A' }, { bad: 1 }] } }),
      );
    vi.stubGlobal('fetch', fetch);

    const items = await fetchItems('mediatype:audio AND collection:(etree)');
    expect(items.map((i) => i.id)).toEqual(['x-1']);
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain('advancedsearch.php?q=');
    expect(url).toContain('mediatype%3Aaudio');
  });

  it('scopes search to the music collections and sanitizes lucene syntax', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ response: { docs: [] } }));
    vi.stubGlobal('fetch', fetch);

    await archiveSource.search('dead (alive) "bootleg" & more');
    const url = String(fetch.mock.calls[0]?.[0]);
    const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
    const userText = q.split(' AND mediatype')[0];
    expect(userText).toBe('dead alive bootleg more');
    expect(q).toContain('collection:(etree OR netlabels OR freemusicarchive)');
  });

  it('resolves an item into its playable files queue', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ files: FILES }));
    vi.stubGlobal('fetch', fetch);

    const result = await archiveSource.resolve(ITEM, []);
    expect(result.index).toBe(0);
    expect(result.tracks).toHaveLength(2);
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://archive.org/metadata/show-1');
  });
});
