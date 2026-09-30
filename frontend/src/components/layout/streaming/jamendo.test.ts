import { afterEach, describe, expect, it, vi } from 'vitest';
import { jamendoSource, keyMissing, toTrack } from './jamendo';

const json = (data: unknown) => ({ ok: true, json: async () => data });

const RAW = {
  id: 123,
  name: 'Tema Uno',
  artist_name: 'Artista Uno',
  duration: 200,
  audio: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31&from=x',
  shareurl: 'https://jamen.do/t/123',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Jamendo mapping', () => {
  it('maps raw tracks and drops entries without an https audio url', () => {
    expect(toTrack(RAW)).toEqual({
      id: '123',
      title: 'Tema Uno',
      artist: 'Artista Uno',
      duration: 200,
      stream: RAW.audio,
      url: RAW.shareurl,
    });
    expect(toTrack({ ...RAW, shareurl: undefined })!.url).toBe(
      'https://www.jamendo.com/track/123',
    );
    expect(toTrack({ ...RAW, audio: 'http://inseguro' })).toBeNull();
    expect(toTrack({ ...RAW, audio: undefined })).toBeNull();
    expect(toTrack({ id: '', name: 'x' })).toBeNull();
    expect(toTrack(null)).toBeNull();
  });
});

describe('Jamendo API', () => {
  it('fails fast without a client id and never calls fetch', async () => {
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', '');
    expect(keyMissing()).toBe(true);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(jamendoSource.browse()).rejects.toThrow();
    await expect(jamendoSource.search('lofi')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests tracks with client_id, trending order and encoded search', async () => {
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'clave-1');
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ headers: { status: 'success' }, results: [RAW, { id: 'x' }] }));
    vi.stubGlobal('fetch', fetch);

    const tracks = await jamendoSource.browse();
    expect(tracks.map((item) => item.id)).toEqual(['123']);
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain('client_id=clave-1');
    expect(url).toContain('order=popularity_week');

    await jamendoSource.search('lo fi & más');
    const searchUrl = String(fetch.mock.calls[1]?.[0]);
    expect(searchUrl).toContain('search=lo%20fi%20%26%20m%C3%A1s');
  });

  it('throws when the API answers a non-success status', async () => {
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'clave-1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ headers: { status: 'failed', code: 11 } })),
    );
    await expect(jamendoSource.browse()).rejects.toThrow();
  });
});
