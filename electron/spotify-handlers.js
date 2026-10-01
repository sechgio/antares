// Despacho de los métodos nativos spotify_* por params.action.
const { SPOTIFY_METHODS } = require('./spotify-ipc-methods');
const session = require('./spotify-session');
const client = require('./spotify-client');
const { emit } = require('./autoimg-notify');

function _required(value, message) {
  if (value === undefined || value === null) throw new client.SpotifyError(message);
  return value;
}

function _nonblank(raw, message) {
  const value = String(raw ?? '').trim();
  if (!value) throw new client.SpotifyError(message);
  return value;
}

function _coerceBool(raw, fallback = false) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const cleaned = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(cleaned)) return true;
    if (['0', 'false', 'no', 'off'].includes(cleaned)) return false;
  }
  return fallback;
}

function _asList(raw) {
  if (raw === undefined || raw === null) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

function _offset(params) {
  const value = Number(params.offset);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function _limit(params, fallback = 20) {
  const value = Number(params.limit);
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(1, Math.min(50, n));
}

const _pageParams = (params) => ({
  limit: _limit(params),
  offset: _offset(params),
  market: params.market,
});

const _ok = (action, result, extra = {}) => ({ success: true, action, ...extra, result });

function _sanitizeError(err) {
  if (err instanceof client.SpotifyError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Error de Spotify: ${message.slice(0, 280)}`);
}

const _EMPTY_PLAYBACK = {
  get_currently_playing: ['is_playing', 'Spotify no está reproduciendo nada ahora mismo.'],
  get_state: ['has_active_device', 'No hay una sesión de reproducción de Spotify activa.'],
};

async function _playbackRead(fetchFn, params, action) {
  const payload = await fetchFn({ market: params.market });
  if (payload && typeof payload === 'object' && payload.empty) {
    const [flag, fallback] = _EMPTY_PLAYBACK[action];
    return {
      success: true,
      action,
      [flag]: false,
      status_code: payload.status_code ?? 204,
      message: payload.message || fallback,
    };
  }
  return payload;
}

const _CONTEXT_TYPES = [
  ['album', 'spotify:album:', '/album/'],
  ['playlist', 'spotify:playlist:', '/playlist/'],
  ['artist', 'spotify:artist:', '/artist/'],
];

async function _pbPlay(params, action) {
  const offset = params.offset && typeof params.offset === 'object'
    ? Object.fromEntries(Object.entries(params.offset).filter(([, v]) => v !== null && v !== undefined))
    : undefined;
  const uris = params.uris ? client.normalizeSpotifyUris(_asList(params.uris), 'track') : undefined;
  let contextUri;
  if (params.context_uri) {
    const raw = String(params.context_uri);
    const contextType = _CONTEXT_TYPES.find(([, prefix, frag]) => raw.startsWith(prefix) || raw.includes(frag))?.[0] ?? null;
    contextUri = client.normalizeSpotifyUri(raw, contextType || undefined);
  }
  const body = {
    context_uri: contextUri,
    uris,
    offset,
    position_ms: params.position_ms,
  };
  return _ok(action, await client.request('PUT', '/me/player/play', {
    params: { device_id: params.device_id },
    jsonBody: body,
  }));
}

const _pbDeviceCmd = (method, path) => async (params, action) =>
  _ok(action, await client.request(method, path, { params: { device_id: params.device_id } }));

function _pbRequiredParam(path, param, convert) {
  return async (params, action) =>
    _ok(action, await client.request('PUT', path, {
      params: { [param]: convert(_required(params[param], `${param} es requerido para action='${action}'`)), device_id: params.device_id },
    }));
}

function _pbRepeatState(params) {
  const state = String(params.state || '').trim().toLowerCase();
  if (!['track', 'context', 'off'].includes(state)) {
    throw new client.SpotifyError("state debe ser uno de: track, context, off");
  }
  return state;
}

async function _pbRecentlyPlayed(params) {
  const after = params.after;
  const before = params.before;
  if (after && before) {
    throw new client.SpotifyError("Usa solo uno de 'after' o 'before'");
  }
  return client.request('GET', '/me/player/recently-played', {
    params: {
      limit: _limit(params),
      after: after !== undefined && after !== null ? Math.trunc(Number(after)) : undefined,
      before: before !== undefined && before !== null ? Math.trunc(Number(before)) : undefined,
    },
  });
}

const _PLAYBACK_ACTIONS = {
  get_state: (params, action) => _playbackRead(client.getPlaybackState, params, action),
  get_currently_playing: (params, action) => _playbackRead(client.getCurrentlyPlaying, params, action),
  play: _pbPlay,
  pause: _pbDeviceCmd('PUT', '/me/player/pause'),
  next: _pbDeviceCmd('POST', '/me/player/next'),
  previous: _pbDeviceCmd('POST', '/me/player/previous'),
  seek: _pbRequiredParam('/me/player/seek', 'position_ms', (v) => Math.trunc(Number(v))),
  set_repeat: async (params, action) => _ok(action, await client.request('PUT', '/me/player/repeat', {
    params: { state: _pbRepeatState(params), device_id: params.device_id },
  })),
  set_shuffle: async (params, action) => _ok(action, await client.request('PUT', '/me/player/shuffle', {
    params: { state: String(_coerceBool(params.state)).toLowerCase(), device_id: params.device_id },
  })),
  set_volume: _pbRequiredParam('/me/player/volume', 'volume_percent', (v) => Math.max(0, Math.min(100, Math.trunc(Number(v))))),
  recently_played: _pbRecentlyPlayed,
};

const _DEVICES_ACTIONS = {
  list: () => client.request('GET', '/me/player/devices'),
  transfer: async (params, action) => _ok(action, await client.request('PUT', '/me/player', {
    jsonBody: {
      device_ids: [_nonblank(params.device_id, "device_id es requerido para action='transfer'")],
      play: _coerceBool(params.play),
    },
  })),
};

async function _queueAdd(params, action) {
  const uri = client.normalizeSpotifyUri(String(params.uri || ''));
  return _ok(action, await client.request('POST', '/me/player/queue', {
    params: { uri, device_id: params.device_id },
  }), { uri });
}

const _QUEUE_ACTIONS = {
  get: () => client.request('GET', '/me/player/queue'),
  add: _queueAdd,
};

const _SEARCH_TYPES = new Set(['album', 'artist', 'playlist', 'track', 'show', 'episode', 'audiobook']);

async function _search(params) {
  const query = _nonblank(params.query, 'query es requerido');
  const rawTypes = _asList(params.types ?? params.type ?? ['track']);
  const searchTypes = rawTypes.map((v) => v.toLowerCase()).filter((v) => _SEARCH_TYPES.has(v));
  if (!searchTypes.length) {
    throw new client.SpotifyError('types debe contener uno o más de: album, artist, playlist, track, show, episode, audiobook');
  }
  return client.request('GET', '/search', {
    params: {
      q: query,
      type: searchTypes.join(','),
      limit: _limit(params, 10),
      offset: _offset(params),
      market: params.market,
      include_external: params.include_external,
    },
  });
}

const _playlistPath = (params, suffix = '') =>
  `/playlists/${client.normalizeSpotifyId(String(params.playlist_id || ''), 'playlist')}${suffix}`;

const _PLAYLISTS_ACTIONS = {
  list: (params) => client.request('GET', '/me/playlists', {
    params: { limit: _limit(params), offset: _offset(params) },
  }),
  get: (params) => client.request('GET', _playlistPath(params), { params: { market: params.market } }),
  create: (params) => client.request('POST', '/me/playlists', {
    jsonBody: {
      name: _nonblank(params.name, "name es requerido para action='create'"),
      public: _coerceBool(params.public),
      collaborative: _coerceBool(params.collaborative),
      description: params.description,
    },
  }),
  add_items: (params) => client.request('POST', _playlistPath(params, '/items'), {
    jsonBody: {
      uris: client.normalizeSpotifyUris(_asList(params.uris)),
      position: params.position,
    },
  }),
  remove_items: (params) => client.request('DELETE', _playlistPath(params, '/items'), {
    jsonBody: {
      items: client.normalizeSpotifyUris(_asList(params.uris)).map((uri) => ({ uri })),
      snapshot_id: params.snapshot_id,
    },
  }),
  update_details: (params) => client.request('PUT', _playlistPath(params), {
    jsonBody: {
      name: params.name,
      public: params.public,
      collaborative: params.collaborative,
      description: params.description,
    },
  }),
};

const _albumPath = (params, suffix = '') =>
  `/albums/${client.normalizeSpotifyId(String(params.album_id || params.id || ''), 'album')}${suffix}`;

const _ALBUMS_ACTIONS = {
  get: (params) => client.request('GET', _albumPath(params), { params: { market: params.market } }),
  tracks: (params) => client.request('GET', _albumPath(params, '/tracks'), { params: _pageParams(params) }),
};

function _libRemoveUris(params, itemType) {
  const ids = _asList(params.ids ?? params.items).map((item) => client.normalizeSpotifyId(item, itemType));
  _required(ids.length ? ids : null, "ids/items es requerido para action='remove'");
  return ids.map((id) => `spotify:${itemType}:${id}`).join(',');
}

async function _library(params) {
  const kind = String(params.kind || '').trim().toLowerCase();
  if (!['tracks', 'albums'].includes(kind)) {
    throw new client.SpotifyError('kind debe ser uno de: tracks, albums');
  }
  const itemType = kind.slice(0, -1);
  const action = String(params.action || 'list').trim().toLowerCase();
  switch (action) {
    case 'list':
      return client.request('GET', `/me/${kind}`, { params: _pageParams(params) });
    case 'save':
      return client.request('PUT', '/me/library', {
        params: { uris: client.normalizeSpotifyUris(_asList(params.uris ?? params.items), itemType).join(',') },
      });
    case 'remove':
      return client.request('DELETE', '/me/library', { params: { uris: _libRemoveUris(params, itemType) } });
    default:
      throw new client.SpotifyError(`Acción de spotify_library desconocida: ${action}`);
  }
}

function _dispatch(table, defaultAction) {
  return async (params) => {
    const action = String(params.action || defaultAction).trim().toLowerCase();
    const handler = table[action];
    if (!handler) throw new client.SpotifyError(`Acción desconocida: ${action}`);
    return handler(params, action);
  };
}

async function handleSpotifyCall(method, params = {}) {
  if (!SPOTIFY_METHODS.has(method)) return { handled: false };

  try {
    switch (method) {
      case 'spotify_oauth_config_status': {
        return { handled: true, result: session.getOAuthConfigStatus() };
      }

      case 'spotify_oauth_config_save': {
        const result = session.saveOAuthConfig(params.client_id || '', params.redirect_uri || '');
        return { handled: true, result };
      }

      case 'spotify_auth_start': {
        const { shell } = require('electron');
        const result = await session.beginBrowserOAuthFlow(
          (status) => emit('spotify.auth.complete', status),
          (err) => emit('spotify.auth.error', {
            message: _sanitizeError(err).message,
          }),
        );
        await shell.openExternal(result.url);
        return { handled: true, result: { ...result, opened: true } };
      }

      case 'spotify_auth_cancel':
        session.cancelBrowserOAuthFlow();
        return { handled: true, result: { success: true } };

      case 'spotify_auth_status':
        return { handled: true, result: await session.getAuthStatus() };

      case 'spotify_auth_revoke':
        return { handled: true, result: await session.revokeAuth() };

      case 'spotify_playback':
        return { handled: true, result: await _dispatch(_PLAYBACK_ACTIONS, 'get_state')(params) };

      case 'spotify_devices':
        return { handled: true, result: await _dispatch(_DEVICES_ACTIONS, 'list')(params) };

      case 'spotify_queue':
        return { handled: true, result: await _dispatch(_QUEUE_ACTIONS, 'get')(params) };

      case 'spotify_search':
        return { handled: true, result: await _search(params) };

      case 'spotify_playlists':
        return { handled: true, result: await _dispatch(_PLAYLISTS_ACTIONS, 'list')(params) };

      case 'spotify_albums':
        return { handled: true, result: await _dispatch(_ALBUMS_ACTIONS, 'get')(params) };

      case 'spotify_library':
        return { handled: true, result: await _library(params) };

      default:
        return { handled: false };
    }
  } catch (err) {
    throw _sanitizeError(err);
  }
}

module.exports = { handleSpotifyCall };
