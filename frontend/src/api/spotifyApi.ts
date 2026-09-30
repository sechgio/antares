type IpcInvoke = <T>(method: string, params?: Record<string, unknown> | object) => Promise<T>;

export interface SpotifyOAuthConfigStatus {
  configured: boolean;
  client_id_masked?: string;
  redirect_uri?: string;
}

export interface SpotifyAuthStatus {
  authenticated: boolean;
  id?: string;
  display_name?: string;
  product?: string;
}

export interface SpotifyPlaybackParams {
  action?:
    | 'get_state'
    | 'get_currently_playing'
    | 'play'
    | 'pause'
    | 'next'
    | 'previous'
    | 'seek'
    | 'set_repeat'
    | 'set_shuffle'
    | 'set_volume'
    | 'recently_played';
  device_id?: string;
  market?: string;
  context_uri?: string;
  uris?: string[];
  offset?: { position?: number; uri?: string };
  position_ms?: number;
  state?: string | boolean;
  volume_percent?: number;
  limit?: number;
  after?: number;
  before?: number;
}

export interface SpotifyActionResult {
  success: boolean;
  action?: string;
  result?: unknown;
  message?: string;
  is_playing?: boolean;
  has_active_device?: boolean;
  uri?: string;
}

export interface SpotifySearchParams {
  query: string;
  types?: string[];
  limit?: number;
  offset?: number;
  market?: string;
}

export interface SpotifyPlaylistsParams {
  action?: 'list' | 'get' | 'create' | 'add_items' | 'remove_items' | 'update_details';
  playlist_id?: string;
  market?: string;
  limit?: number;
  offset?: number;
  name?: string;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  uris?: string[];
  position?: number;
  snapshot_id?: string;
}

export interface SpotifyAlbumsParams {
  action?: 'get' | 'tracks';
  album_id?: string;
  market?: string;
  limit?: number;
  offset?: number;
}

export interface SpotifyLibraryParams {
  kind: 'tracks' | 'albums';
  action?: 'list' | 'save' | 'remove';
  limit?: number;
  offset?: number;
  market?: string;
  uris?: string[];
  ids?: string[];
}

export function createSpotifyApi(invoke: IpcInvoke) {
  return {
    spotifyOauthConfigStatus: () => invoke<SpotifyOAuthConfigStatus>('spotify_oauth_config_status'),
    spotifyOauthConfigSave: (client_id: string, redirect_uri?: string) =>
      invoke<{ success: boolean }>('spotify_oauth_config_save', { client_id, redirect_uri }),
    spotifyAuthStart: () => invoke<{ url: string; redirect_uri: string; opened?: boolean }>('spotify_auth_start'),
    spotifyAuthCancel: () => invoke<{ success: boolean }>('spotify_auth_cancel'),
    spotifyAuthStatus: () => invoke<SpotifyAuthStatus>('spotify_auth_status'),
    spotifyAuthRevoke: () => invoke<{ success: boolean }>('spotify_auth_revoke'),
    spotifyPlayback: (params: SpotifyPlaybackParams = {}) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_playback', params),
    spotifyDevices: (params: { action?: 'list' | 'transfer'; device_id?: string; play?: boolean } = {}) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_devices', params),
    spotifyQueue: (params: { action?: 'get' | 'add'; uri?: string; device_id?: string } = {}) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_queue', params),
    spotifySearch: (params: SpotifySearchParams) =>
      invoke<Record<string, unknown>>('spotify_search', params),
    spotifyPlaylists: (params: SpotifyPlaylistsParams = {}) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_playlists', params),
    spotifyAlbums: (params: SpotifyAlbumsParams = {}) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_albums', params),
    spotifyLibrary: (params: SpotifyLibraryParams) =>
      invoke<Record<string, unknown> & SpotifyActionResult>('spotify_library', params),
  };
}
