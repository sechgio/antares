// Cliente Spotify Web API usado por los métodos nativos spotify_*.
const {
  API_BASE,
  REAUTH_REQUIRED_MESSAGE,
  getValidTokens,
  forceRefreshTokens,
} = require('./spotify-session');
const { fetchWithRetry } = require('./autoimg-google-fetch');

class SpotifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpotifyError';
  }
}

class SpotifyAuthRequiredError extends SpotifyError {
  constructor(message) {
    super(message);
    this.name = 'SpotifyAuthRequiredError';
  }
}

class SpotifyAPIError extends SpotifyError {
  constructor(message, { statusCode = null, responseBody = null, path = null } = {}) {
    super(message);
    this.name = 'SpotifyAPIError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.path = path;
  }
}

function _stripNone(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

function _withQuery(url, params) {
  const clean = _stripNone(params);
  const keys = Object.keys(clean);
  if (!keys.length) return url;
  const qs = new URLSearchParams();
  for (const key of keys) qs.set(key, String(clean[key]));
  return `${url}?${qs.toString()}`;
}

function _extractErrorDetail(bodyText, fallback) {
  try {
    const errorObj = JSON.parse(bodyText).error;
    if (errorObj && typeof errorObj === 'object' && errorObj.message) {
      return String(errorObj.message).trim();
    }
    if (typeof errorObj === 'string') return errorObj.trim();
  } catch {
  }
  return String(fallback || '').trim();
}

function _friendlyErrorMessage({ statusCode, detail, path, retryAfter }) {
  const isPlaybackPath = String(path).startsWith('/me/player');
  if (statusCode === 401) {
    return 'La autenticación con Spotify falló o expiró. Vuelve a conectar tu cuenta.';
  }
  if (statusCode === 403) {
    if (isPlaybackPath) {
      return 'Spotify rechazó la acción de reproducción. El control de reproducción suele requerir una cuenta Premium y un dispositivo Spotify Connect activo.';
    }
    if (/scope|permission/i.test(detail)) {
      return 'Spotify rechazó la solicitud por permisos insuficientes. Reconecta tu cuenta para refrescar los scopes.';
    }
    return 'Spotify rechazó la solicitud. La cuenta puede no tener permiso para esta acción.';
  }
  if (statusCode === 404) {
    return isPlaybackPath
      ? 'Spotify no encontró un dispositivo o sesión de reproducción activa para esta solicitud.'
      : 'Recurso de Spotify no encontrado.';
  }
  if (statusCode === 429) {
    return `Límite de peticiones de Spotify excedido.${retryAfter ? ` Reintenta tras ${retryAfter} segundos.` : ''}`;
  }
  return detail || `La petición a Spotify falló con estado ${statusCode}.`;
}

async function _request(method, path, { params, jsonBody, allowRetryOn401 = true, emptyResponse } = {}) {
  const tokens = await getValidTokens();
  if (!tokens?.access_token) {
    throw new SpotifyAuthRequiredError(REAUTH_REQUIRED_MESSAGE);
  }
  const res = await fetchWithRetry(
    _withQuery(`${API_BASE}${path}`, params),
    {
      method,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: jsonBody !== undefined && jsonBody !== null ? JSON.stringify(_stripNone(jsonBody)) : undefined,
    },
    { provider: 'spotify' },
  );
  if (res.status === 401 && allowRetryOn401) {
    try { await res.text(); } catch {}
    let fresh;
    try {
      fresh = await forceRefreshTokens();
    } catch (err) {
      throw new SpotifyAuthRequiredError(
        err instanceof Error ? err.message : REAUTH_REQUIRED_MESSAGE,
      );
    }
    if (!fresh?.access_token) throw new SpotifyAuthRequiredError(REAUTH_REQUIRED_MESSAGE);
    return _request(method, path, { params, jsonBody, allowRetryOn401: false, emptyResponse });
  }
  if (res.status >= 400) {
    const detail = (await res.text()).trim();
    throw new SpotifyAPIError(
      _friendlyErrorMessage({
        statusCode: res.status,
        detail: _extractErrorDetail(detail, detail),
        path,
        retryAfter: res.headers.get('Retry-After'),
      }),
      { statusCode: res.status, responseBody: detail, path },
    );
  }
  if (res.status === 204) {
    return emptyResponse || { success: true, status_code: 204, empty: true };
  }
  const text = await res.text();
  if (!text) {
    return emptyResponse || { success: true, status_code: res.status, empty: true };
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { success: true, text };
    }
  }
  return { success: true, text };
}

const _empty204 = (message) => ({ status_code: 204, empty: true, message });

function getPlaybackState({ market } = {}) {
  return _request('GET', '/me/player', {
    params: { market },
    emptyResponse: _empty204(
      'No hay una sesión de reproducción de Spotify activa. Abre Spotify en un dispositivo y empieza a reproducir, o transfiere la reproducción a un dispositivo disponible.',
    ),
  });
}

function getCurrentlyPlaying({ market } = {}) {
  return _request('GET', '/me/player/currently-playing', {
    params: { market },
    emptyResponse: _empty204(
      'Spotify no está reproduciendo nada ahora mismo. Inicia la reproducción en Spotify e inténtalo de nuevo.',
    ),
  });
}

function _checkType(itemType, expectedType) {
  if (expectedType && itemType !== expectedType) {
    throw new SpotifyError(`Se esperaba un ${expectedType} de Spotify, recibido ${itemType}.`);
  }
}

function normalizeSpotifyId(value, expectedType) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw new SpotifyError('Se requiere id/uri/url de Spotify.');
  let parts = cleaned.startsWith('spotify:') ? cleaned.split(':').slice(1) : [];
  if (parts.length < 2 && cleaned.includes('open.spotify.com')) {
    try {
      parts = new URL(cleaned).pathname.split('/').filter(Boolean);
    } catch {
      parts = [];
    }
  }
  if (parts.length >= 2) {
    _checkType(parts[0], expectedType);
    return parts[1];
  }
  return cleaned;
}

function normalizeSpotifyUri(value, expectedType) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw new SpotifyError('Se requiere URI/url/id de Spotify.');
  if (cleaned.startsWith('spotify:')) {
    const parts = cleaned.split(':');
    if (expectedType && parts.length >= 3) _checkType(parts[1], expectedType);
    return cleaned;
  }
  const itemId = normalizeSpotifyId(cleaned, expectedType);
  return expectedType ? `spotify:${expectedType}:${itemId}` : cleaned;
}

function normalizeSpotifyUris(values, expectedType) {
  const uris = [...new Set((values || []).map((v) => normalizeSpotifyUri(v, expectedType)))];
  if (!uris.length) throw new SpotifyError('Se requiere al menos un elemento de Spotify.');
  return uris;
}

module.exports = {
  SpotifyError,
  SpotifyAuthRequiredError,
  request: _request,
  getPlaybackState,
  getCurrentlyPlaying,
  normalizeSpotifyId,
  normalizeSpotifyUri,
  normalizeSpotifyUris,
};
