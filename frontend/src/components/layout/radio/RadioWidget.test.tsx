import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RadioWidget from './RadioWidget';
import { createPlayer } from './player';
import { artistProfile, resolveArtist, trackCredit } from './artist';
import { uniqueStations, validStation } from './core';

class BroadcastChannelStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {}
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }
}
vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);

const json = (data: unknown) => ({ ok: true, json: async () => data });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
});

describe('RadioWidget station helpers', () => {
  it('validates https stations and deduplicates by id and url', () => {
    expect(validStation({ id: 'a', name: 'A', url: 'https://x.test/stream.mp3' })).toBe(true);
    expect(validStation({ id: 'a', name: 'A', url: 'http://x.test/stream.mp3' })).toBe(false);
    expect(validStation({ id: 'a', name: 'A', url: 'https://u:p@x.test/s' })).toBe(false);
    expect(validStation({ name: 'A', url: 'https://x.test/s' })).toBe(false);
    expect(validStation(null)).toBe(false);

    const a = { id: 'a', name: 'A', url: 'https://x.test/a' };
    const sameById = { id: 'a', name: 'A2', url: 'https://x.test/b' };
    const sameByUrl = { id: 'b', name: 'B', url: 'https://x.test/a' };
    const c = { id: 'c', name: 'C', url: 'https://x.test/c' };
    expect(uniqueStations([a, sameById, sameByUrl, c])).toEqual([a, c]);
  });
});

describe('RadioWidget artist credits', () => {
  it('separates only a credited artist and accepts direct artist destinations, never track or search links', () => {
    expect(trackCredit({ title: 'AC-DC - Thunderstruck' })).toEqual({
      artist: 'AC-DC',
      title: 'Thunderstruck',
    });
    expect(trackCredit({ artist: 'AC-DC', title: 'Live - Part Two' })).toEqual({
      artist: 'AC-DC',
      title: 'Live - Part Two',
    });
    expect(trackCredit({ title: 'Unstructured broadcast' }).artist).toBe('');
    expect(trackCredit(null).artist).toBe('');

    const spotify = 'https://open.spotify.com/artist/5V8x0GqH9GCBPl1fYeOhuB';
    const bandcamp = 'https://davdralleon.bandcamp.com/';
    const relation = (type: string, resource: string) => ({ type, url: { resource } });
    expect(artistProfile([relation('bandcamp', bandcamp), relation('free streaming', spotify)])).toBe(
      spotify,
    );
    expect(
      artistProfile([
        relation('free streaming', 'https://open.spotify.com/track/5V8x0GqH9GCBPl1fYeOhuB'),
        relation('free streaming', 'https://open.spotify.com/search/Dav'),
        relation('bandcamp', `${bandcamp}track/song`),
        relation('official homepage', 'javascript:alert(1)'),
      ]),
    ).toBeNull();
    expect(artistProfile([relation('bandcamp', bandcamp)])).toBe(bandcamp);
  });

  it('resolves exact artist profiles, rejects ambiguity, and falls back after an unavailable provider', async () => {
    localStorage.setItem('antares.radio.artistRequestAt', JSON.stringify(Date.now()));
    const apple = 'https://music.apple.com/us/artist/hello-meteor/1080606463';
    const row = { wrapperType: 'artist', artistName: 'Hello Meteor', artistLinkUrl: `${apple}?uo=4` };
    const fetch = vi.fn().mockResolvedValueOnce(json({ results: [row] }));
    vi.stubGlobal('fetch', fetch);
    expect(await resolveArtist('Hello Meteor')).toBe(apple);
    const request = new URL(fetch.mock.calls[0][0] as string);
    expect(request.searchParams.get('entity')).toBe('musicArtist');
    expect(request.searchParams.get('term')).toBe('Hello Meteor');
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockResolvedValueOnce(
      json({
        results: [
          row,
          { ...row, artistLinkUrl: 'https://music.apple.com/us/artist/hello-meteor/2' },
        ],
      }),
    );
    expect(await resolveArtist('Hello Meteor')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);

    const id = '08d6699f-ec17-434c-a922-3684531840d1';
    const spotify = 'https://open.spotify.com/artist/5V8x0GqH9GCBPl1fYeOhuB';
    fetch
      .mockRejectedValueOnce(new Error('Apple unavailable'))
      .mockResolvedValueOnce(json({ artists: [{ name: 'Dav Dralleon', id, score: 100 }] }))
      .mockResolvedValueOnce(
        json({ relations: [{ type: 'free streaming', url: { resource: spotify } }] }),
      );
    expect(await resolveArtist('Dav Dralleon')).toBe(spotify);
    expect(fetch.mock.calls.at(-1)?.[0]).toContain(`/artist/${id}?inc=url-rels`);
  });
});

describe('RadioWidget player lifecycle', () => {
  it('does not autoplay on mount and releases the stream on dispose, ignoring late media events', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('AudioContext', undefined);

    const player = createPlayer();
    expect(player.status.get()).toBe('paused');
    expect(document.querySelector('audio')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    await player.play();
    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    media!.dispatchEvent(new Event('playing'));
    expect(player.status.get()).toBe('live');

    player.dispose();
    expect(document.querySelector('audio')).toBeNull();
    expect(media!.hasAttribute('src')).toBe(false);
    media!.dispatchEvent(new Event('playing'));
    expect(player.status.get()).toBe('paused');
  });

  it('renders the status-bar widget without creating audio or fetching', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { container } = render(<RadioWidget />);
    expect(container.querySelector('.antares-radio-bar')).not.toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps playback working after StrictMode effect replays', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('AudioContext', undefined);
    const { getByRole } = render(
      <StrictMode>
        <RadioWidget />
      </StrictMode>,
    );
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reproducir radio' }));
    });
    expect(document.querySelector('audio')).not.toBeNull();
  });
});
