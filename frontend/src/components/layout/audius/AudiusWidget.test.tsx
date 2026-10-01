import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AudiusWidget from './AudiusWidget';
import { fetchTrending, resetAudiusForTests, searchTracks, streamUrl, toTrack } from './core';
import { createAudiusPlayer } from './player';
import { createStreamPlayer } from '../streaming/player';

const json = (data: unknown) => ({ ok: true, json: async () => data });

const RAW_ONE = {
  id: 'aaaaaa',
  title: 'Canción Uno',
  duration: 71,
  permalink: '/artista/cancion-uno',
  user: { name: 'Artista Uno' },
};
const RAW_TWO = {
  id: 'bbbbbb',
  title: 'Canción Dos',
  duration: 204,
  permalink: '/artista/cancion-dos',
  user: { name: 'Artista Dos' },
};

function mockAudiusFetch(tracks: unknown[]) {
  return vi.fn().mockImplementation((input: string) => {
    const url = String(input);
    if (url === 'https://api.audius.co') {
      return Promise.resolve(json({ data: ['https://api.audius.co'] }));
    }
    if (url.includes('/v1/tracks/search') || url.includes('/v1/tracks/trending')) {
      return Promise.resolve(json({ data: tracks }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

function mockMedia() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetAudiusForTests();
  for (const source of ['audius', 'jamendo', 'archive', 'test-other']) {
    window.localStorage.removeItem(`antares.${source}.volume`);
  }
});

describe('Audius core mapping', () => {
  it('maps raw tracks to the lite shape and drops malformed entries', () => {
    expect(toTrack(RAW_ONE)).toEqual({
      id: 'aaaaaa',
      title: 'Canción Uno',
      artist: 'Artista Uno',
      duration: 71,
      url: 'https://audius.co/artista/cancion-uno',
    });
    expect(toTrack({ ...RAW_ONE, user: undefined, permalink: undefined })).toEqual({
      id: 'aaaaaa',
      title: 'Canción Uno',
      artist: '',
      duration: 71,
      url: 'https://audius.co/',
    });
    expect(toTrack({ id: '', title: 'Sin id' })).toBeNull();
    expect(toTrack({ id: 'x' })).toBeNull();
    expect(toTrack(null)).toBeNull();
  });
});

describe('Audius API client', () => {
  it('resolves the discovery host, lists trending tracks and encodes search queries', async () => {
    const fetch = mockAudiusFetch([RAW_ONE, { id: 'broken' }, RAW_TWO]);
    vi.stubGlobal('fetch', fetch);

    const trending = await fetchTrending();
    expect(trending.map((item) => item.id)).toEqual(['aaaaaa', 'bbbbbb']);
    expect(fetch.mock.calls.some(([u]) => String(u) === 'https://api.audius.co')).toBe(true);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/v1/tracks/trending'))).toBe(true);

    const results = await searchTracks('lo fi & más');
    expect(results).toHaveLength(2);
    const searched = fetch.mock.calls.find(([u]) => String(u).includes('/v1/tracks/search'));
    expect(String(searched?.[0])).toContain('query=lo%20fi%20%26%20m%C3%A1s');
  });

  it('reports search failures without results', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetch);
    await expect(searchTracks('x')).rejects.toThrow();
  });

  it('points the stream URL at the resolved discovery host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: string) => {
        const url = String(input);
        if (url === 'https://api.audius.co') {
          return Promise.resolve(json({ data: ['https://creator.audius.co/'] }));
        }
        return Promise.resolve(json({ data: [RAW_ONE] }));
      }),
    );

    await fetchTrending();
    expect(streamUrl(toTrack(RAW_ONE)!)).toBe(
      'https://creator.audius.co/v1/tracks/aaaaaa/stream?app_name=antares',
    );
  });

  it('serves trending from the cache within its window', async () => {
    const fetch = mockAudiusFetch([RAW_ONE, RAW_TWO]);
    vi.stubGlobal('fetch', fetch);

    await fetchTrending();
    const calls = fetch.mock.calls.length;
    await expect(fetchTrending()).resolves.toHaveLength(2);
    expect(fetch.mock.calls).toHaveLength(calls);
  });

  it('builds API paths without a duplicated slash after the resolved host', async () => {
    const fetch = mockAudiusFetch([RAW_ONE]);
    vi.stubGlobal('fetch', fetch);

    await fetchTrending();
    await searchTracks('lo fi');

    const apiCalls = fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/v1/'));
    expect(apiCalls).toHaveLength(2);
    for (const url of apiCalls) {
      expect(url.startsWith('https://api.audius.co/v1/')).toBe(true);
    }
  });
});

describe('Audius player lifecycle', () => {
  it.each(['audius', 'jamendo', 'archive'])('preserves playback, errors, volume and disposal for %s', async (source) => {
    mockMedia();
    window.localStorage.setItem(`antares.${source}.volume`, '38');
    window.localStorage.setItem('antares.test-other.volume', '62');
    const player = source === 'audius' ? createAudiusPlayer() : createStreamPlayer(source);
    const one = { ...toTrack(RAW_ONE)!, stream: 'https://audio.example/one.mp3' };
    const two = { ...toTrack(RAW_TWO)!, stream: 'https://audio.example/two.mp3' };
    const url = (item: typeof one) => source === 'audius' ? streamUrl(item) : item.stream;
    expect(player.volume.get()).toBe(38);
    expect(player.status.get()).toBe('paused');
    expect(document.querySelector('audio')).toBeNull();
    player.queue.set([one, two]);
    player.toggle();
    const media = document.querySelector('audio')!;
    expect(media.getAttribute('src')).toBe(url(one));
    expect(media.volume).toBe(0.38);
    media.dispatchEvent(new Event('playing'));
    expect(player.status.get()).toBe('live');
    player.toggle();
    expect(player.status.get()).toBe('paused');
    player.toggle();
    expect(player.status.get()).toBe('connecting');
    player.previous();
    expect(player.track.get()).toBe(two);
    expect(media.getAttribute('src')).toBe(url(two));
    media.dispatchEvent(new Event('ended'));
    expect(player.track.get()).toBe(one);
    player.next();
    expect(player.track.get()).toBe(two);
    media.dispatchEvent(new Event('error'));
    expect(player.status.get()).toBe('error');
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('blocked'));
    player.select(one);
    await Promise.resolve();
    expect(player.status.get()).toBe('error');
    player.setVolume(300);
    expect(player.volume.get()).toBe(100);
    player.setVolume(-5);
    expect(player.volume.get()).toBe(0);
    player.setVolume(47);
    player.mute();
    expect(player.volume.get()).toBe(0);
    player.mute();
    expect(media.volume).toBe(0.47);
    expect(window.localStorage.getItem(`antares.${source}.volume`)).toBe('47');
    expect(window.localStorage.getItem('antares.test-other.volume')).toBe('62');
    player.dispose();
    expect(media.getAttribute('src')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    media.dispatchEvent(new Event('playing'));
    media.dispatchEvent(new Event('ended'));
    expect(player.status.get()).toBe('error');
    expect(player.track.get()).toBe(one);
    const calls = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    player.select(two);
    player.toggle();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(calls);
    const restored = source === 'audius' ? createAudiusPlayer() : createStreamPlayer(source);
    expect(restored.volume.get()).toBe(47);
    restored.dispose();
  });

  it('resolves the Audius host again when advancing after discovery', async () => {
    mockMedia();
    const fetch = vi.fn().mockImplementation((input: string) => Promise.resolve(
      json({ data: input === 'https://api.audius.co' ? ['https://creator.audius.co/'] : [RAW_ONE, RAW_TWO] }),
    ));
    vi.stubGlobal('fetch', fetch);
    const player = createAudiusPlayer();
    player.select(toTrack(RAW_ONE)!, [toTrack(RAW_ONE)!, toTrack(RAW_TWO)!]);
    expect(document.querySelector('audio')!.getAttribute('src')).toContain('https://api.audius.co/');
    expect(fetch).not.toHaveBeenCalled();
    await fetchTrending();
    player.next();
    expect(document.querySelector('audio')!.getAttribute('src')).toBe(
      'https://creator.audius.co/v1/tracks/bbbbbb/stream?app_name=antares',
    );
    player.dispose();
  });

  it('does not autoplay on mount, advances the queue on end and releases audio on dispose', () => {
    mockMedia();
    const player = createAudiusPlayer();
    expect(player.status.get()).toBe('paused');
    expect(document.querySelector('audio')).toBeNull();

    const one = toTrack(RAW_ONE)!;
    const two = toTrack(RAW_TWO)!;
    player.select(one, [one, two]);

    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    expect(media!.getAttribute('src')).toContain('/v1/tracks/aaaaaa/stream');
    expect(player.track.get()?.id).toBe('aaaaaa');
    expect(player.status.get()).toBe('connecting');

    media!.dispatchEvent(new Event('playing'));
    expect(player.status.get()).toBe('live');

    media!.dispatchEvent(new Event('ended'));
    expect(player.track.get()?.id).toBe('bbbbbb');
    expect(document.querySelector('audio')!.getAttribute('src')).toContain('/v1/tracks/bbbbbb/stream');

    player.previous();
    expect(player.track.get()?.id).toBe('aaaaaa');

    player.toggle();
    expect(player.status.get()).toBe('paused');

    player.dispose();
    expect(document.querySelector('audio')).toBeNull();
  });
});

describe('AudiusWidget', () => {
  it('renders the chip, lists trending tracks in the panel and plays on demand', async () => {
    mockMedia();
    const fetch = mockAudiusFetch([RAW_ONE, RAW_TWO]);
    vi.stubGlobal('fetch', fetch);

    render(<AudiusWidget />);
    await act(async () => {});
    const trigger = screen.getByRole('button', { name: /Abrir panel de Audius/ });
    expect(trigger.textContent).toContain('Audius');
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('audio')).toBeNull();

    await act(async () => {
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(screen.getByText('Canción Uno')).toBeInTheDocument());
    expect(screen.getByText('Artista Dos')).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reproducir: Canción Uno' }));
    });
    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    expect(media!.getAttribute('src')).toContain('/v1/tracks/aaaaaa/stream');
  });

  it('starts playback from the titlebar button once the list is loaded', async () => {
    mockMedia();
    vi.stubGlobal('fetch', mockAudiusFetch([RAW_ONE, RAW_TWO]));

    render(<AudiusWidget />);
    await act(async () => {});
    const trigger = screen.getByRole('button', { name: /Abrir panel de Audius/ });
    await act(async () => {
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(screen.getByText('Canción Uno')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(trigger);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
    });
    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    expect(media!.getAttribute('src')).toContain('/v1/tracks/aaaaaa/stream');
  });
});
