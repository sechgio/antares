import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JamendoWidget from './JamendoWidget';
import ArchiveWidget from './ArchiveWidget';

const json = (data: unknown) => ({ ok: true, json: async () => data });

const JAMENDO_TRACK = {
  id: 123,
  name: 'Tema Uno',
  artist_name: 'Artista Uno',
  duration: 200,
  audio: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31&from=x',
  shareurl: 'https://jamen.do/t/123',
};

const ARCHIVE_DOCS = {
  response: {
    docs: [{ identifier: 'show-1', title: 'Show En Vivo', creator: 'Banda' }],
  },
};

const ARCHIVE_META = {
  files: [
    { name: '01-Intro.mp3', format: 'VBR MP3', length: '00:53', title: 'Intro', track: 1 },
    { name: '02-Tema.mp3', format: 'VBR MP3', length: '05:42', title: 'Tema Dos', track: 2 },
  ],
};

function mockMedia() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('StreamingWidget (Jamendo)', () => {
  it('shows the credential hint instead of fetching when no client id is set', async () => {
    mockMedia();
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    render(<JamendoWidget />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Abrir panel de Jamendo/ }));

    await waitFor(() =>
      expect(screen.getByText(/VITE_JAMENDO_CLIENT_ID/)).toBeInTheDocument(),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('lists tracks and plays them with the resolved stream url', async () => {
    mockMedia();
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'clave-1');
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ headers: { status: 'success' }, results: [JAMENDO_TRACK] }));
    vi.stubGlobal('fetch', fetch);

    render(<JamendoWidget />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Abrir panel de Jamendo/ }));
    await waitFor(() => expect(screen.getByText('Tema Uno')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reproducir: Tema Uno' }));
    });
    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    expect(media!.getAttribute('src')).toBe(JAMENDO_TRACK.audio);
  });
});

describe('StreamingWidget (Archive)', () => {
  it('resolves an item into its file queue before playing', async () => {
    mockMedia();
    const fetch = vi.fn().mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes('advancedsearch.php')) return Promise.resolve(json(ARCHIVE_DOCS));
      if (url.includes('/metadata/show-1')) return Promise.resolve(json(ARCHIVE_META));
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetch);

    render(<ArchiveWidget />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Abrir panel de Archive/ }));
    await waitFor(() => expect(screen.getByText('Show En Vivo')).toBeInTheDocument());
    expect(document.querySelector('audio')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reproducir: Show En Vivo' }));
    });
    const media = document.querySelector('audio');
    expect(media).not.toBeNull();
    expect(media!.getAttribute('src')).toBe('https://archive.org/download/show-1/01-Intro.mp3');
  });
});
