import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SpotifyWidget from './SpotifyWidget';
import { api } from '../../../api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpotifyWidget', () => {
  it('renders the title-bar chip with the spotify mark and no fetch when unauthenticated', async () => {
    vi.spyOn(api, 'spotifyOauthConfigStatus').mockResolvedValue({ configured: false });
    vi.spyOn(api, 'spotifyAuthStatus').mockResolvedValue({ authenticated: false });
    const { container } = render(<SpotifyWidget />);
    await act(async () => {});
    const bar = container.querySelector('.antares-spotify-bar');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('data-spotify-ready')).toBe('false');
    expect(screen.getByRole('button', { name: /Abrir panel de Spotify/ }).textContent).toContain('Spotify');
    expect(container.querySelector('.antares-spotify-mark')).not.toBeNull();
    expect(api.spotifyAuthStatus).not.toHaveBeenCalled();
  });

  it('opens the setup panel instead of firing playback actions while not ready', async () => {
    vi.spyOn(api, 'spotifyOauthConfigStatus').mockResolvedValue({
      configured: true,
      client_id_masked: 'a1b2…y8z9',
    });
    vi.spyOn(api, 'spotifyAuthStatus').mockResolvedValue({ authenticated: false });
    const play = vi.spyOn(api, 'spotifyPlayback').mockRejectedValue(new Error('unreachable'));
    const { container } = render(<SpotifyWidget />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Abrir panel de Spotify/ }));
    });
    expect(container.querySelector('.antares-spotify-setup')).not.toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it('keeps the title-bar container separate from the playback progress bar', async () => {
    vi.spyOn(api, 'spotifyOauthConfigStatus').mockResolvedValue({ configured: true });
    vi.spyOn(api, 'spotifyAuthStatus').mockResolvedValue({ authenticated: true });
    vi.spyOn(api, 'spotifyPlayback').mockResolvedValue({
      success: true,
      item: { name: 'Test', artists: [], duration_ms: 1000 },
      progress_ms: 500,
      is_playing: false,
    });
    const { container } = render(<SpotifyWidget />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Abrir panel de Spotify/ }));
    });

    const bar = container.querySelector('.antares-spotify-bar');
    const progress = container.querySelector('.antares-spotify-progress-bar');
    expect(bar).not.toBeNull();
    expect(progress).not.toBeNull();
    expect(bar?.contains(progress)).toBe(true);
    expect(progress?.classList.contains('antares-spotify-bar')).toBe(false);
  });
});
