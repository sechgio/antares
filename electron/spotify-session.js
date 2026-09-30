const crypto = require('crypto');
const {
  readSecureJson,
  writeSecureJson,
  clearSecureJson,
} = require('./autoimg-secure-storage');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const { maskClientId } = require('./autoimg-security');
const {
  findAvailablePort,
  startCallbackServer,
  stopCallbackServer,
} = require('./autoimg-oauth-flow');

const OAUTH_CONFIG_FILE = 'spotify-oauth-config.json';
const OAUTH_CONFIG_NS = 'spotify:oauth';
const TOKENS_FILE = 'spotify-tokens.json';
const TOKENS_NS = 'spotify:tokens';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

const DEFAULT_CALLBACK_PORT = 43830;
const CALLBACK_PATH = '/callback';
// Puerto explícito obligatorio: Spotify exige coincidencia exacta del redirect_uri
// registrado en la app, y un URI sin puerto iría al 80 (que no podemos abrir).
const LOOPBACK_REDIRECT_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}\/[a-z0-9\-/]*$/i;

const SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
].join(' ');

const REAUTH_REQUIRED_MESSAGE =
  'La sesión de Spotify expiró o fue revocada. Vuelve a conectar tu cuenta desde el widget de Spotify.';

let _pendingRedirectUri = null;
let _pendingCodeVerifier = null;
let _refreshPromise = null;
let _cachedTokens;

function _generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function _generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function loadOAuthConfig() {
  const cfg = readSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS);
  return {
    clientId: String(cfg?.client_id || '').trim(),
    redirectUri: String(cfg?.redirect_uri || '').trim(),
  };
}

function getOAuthConfigStatus() {
  const config = loadOAuthConfig();
  const configured = Boolean(config.clientId);
  return {
    configured,
    client_id_masked: configured ? maskClientId(config.clientId) : undefined,
    redirect_uri: config.redirectUri || undefined,
  };
}

function saveOAuthConfig(clientId, redirectUri) {
  const id = String(clientId || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    throw new Error(
      'Client ID inválido. Debe ser el ID de 32 caracteres hexadecimales de tu app en developer.spotify.com/dashboard.',
    );
  }
  const uri = String(redirectUri || '').trim();
  if (uri && !LOOPBACK_REDIRECT_RE.test(uri)) {
    throw new Error(
      'Redirect URI inválida. Debe ser loopback HTTP con puerto: http://127.0.0.1:43830/callback.',
    );
  }
  const previous = loadOAuthConfig();
  if (previous.clientId && previous.clientId !== id) {
    clearTokens();
  }
  writeSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS, {
    client_id: id,
    ...(uri ? { redirect_uri: uri } : {}),
  });
  return { success: true };
}

function requireOAuthConfig() {
  const config = loadOAuthConfig();
  if (!config.clientId) {
    throw new Error(
      'Client ID de Spotify no configurado. En el widget de Spotify, abre "OAuth" e ingresa el Client ID de tu app.',
    );
  }
  return config;
}

function _safeTokens(tokens) {
  return {
    access_token: tokens?.access_token,
    refresh_token: tokens?.refresh_token,
    expiry_date: tokens?.expiry_date,
    scope: tokens?.scope,
  };
}

function loadTokens() {
  if (_cachedTokens === undefined) {
    _cachedTokens = readSecureJson(TOKENS_FILE, TOKENS_NS);
  }
  return _cachedTokens ? { ..._cachedTokens } : _cachedTokens;
}

function saveTokens(tokens) {
  const safe = _safeTokens(tokens);
  writeSecureJson(TOKENS_FILE, TOKENS_NS, safe);
  _cachedTokens = { ...safe };
}

function clearTokens() {
  clearSecureJson(TOKENS_FILE);
  _cachedTokens = null;
}

function _isInvalidGrant(body) {
  return /invalid_grant/i.test(String(body || ''));
}

async function _refreshTokens(tokens) {
  const config = requireOAuthConfig();
  if (!tokens?.refresh_token) {
    clearTokens();
    throw new Error(REAUTH_REQUIRED_MESSAGE);
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: config.clientId,
  });
  const res = await fetchWithRetry(TOKEN_URL, { method: 'POST', body }, { retries: 0, provider: 'spotify' });
  if (!res.ok) {
    const errBody = await res.text();
    if (_isInvalidGrant(errBody)) {
      clearTokens();
      throw new Error(REAUTH_REQUIRED_MESSAGE);
    }
    throw new Error(`No se pudo refrescar el token de Spotify: ${errBody}`);
  }
  const data = await res.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope || tokens.scope,
  };
  saveTokens(updated);
  return updated;
}

function refreshAccessToken(tokens) {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _refreshTokens(tokens || loadTokens()).finally(() => {
    _refreshPromise = null;
  });
  return _refreshPromise;
}

async function getValidTokens() {
  let tokens = loadTokens();
  if (!tokens) return null;
  const hasAccess = Boolean(tokens.access_token);
  const hasRefresh = Boolean(tokens.refresh_token);
  if (!hasAccess && !hasRefresh) return null;
  const expiresSoon = !tokens.expiry_date || tokens.expiry_date < Date.now() + 60_000;
  if (!hasAccess || expiresSoon) {
    if (!hasRefresh) {
      clearTokens();
      return null;
    }
    try {
      tokens = await refreshAccessToken(tokens);
    } catch (err) {
      if (err instanceof Error && err.message === REAUTH_REQUIRED_MESSAGE) return null;
      throw err;
    }
  }
  return tokens;
}

// El cliente envuelve el fallo en SpotifyAuthRequiredError; aquí propagamos el
// error de refresh tal cual para no crear un require circular.
async function forceRefreshTokens() {
  return refreshAccessToken();
}

function _buildAuthUrl(redirectUri, codeChallenge, state) {
  const cfg = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function cancelBrowserOAuthFlow() {
  stopCallbackServer();
  _pendingRedirectUri = null;
  _pendingCodeVerifier = null;
}

async function beginBrowserOAuthFlow(onComplete, onError) {
  cancelBrowserOAuthFlow();
  const cfg = requireOAuthConfig();

  let port;
  let redirectUri;
  if (cfg.redirectUri) {
    const parsed = new URL(cfg.redirectUri);
    port = Number(parsed.port) || 0;
    if (!port) {
      throw new Error('La redirect URI de Spotify debe incluir puerto, p. ej. http://127.0.0.1:43830/callback.');
    }
    redirectUri = cfg.redirectUri;
  } else {
    port = await findAvailablePort(DEFAULT_CALLBACK_PORT);
    redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  }

  const codeVerifier = _generateCodeVerifier();
  const codeChallenge = _generateCodeChallenge(codeVerifier);
  const oauthState = crypto.randomBytes(24).toString('base64url');
  _pendingRedirectUri = redirectUri;
  _pendingCodeVerifier = codeVerifier;
  const url = _buildAuthUrl(redirectUri, codeChallenge, oauthState);
  const callbackPath = new URL(redirectUri).pathname;

  startCallbackServer(port, {
    expectedState: oauthState,
    callbackPath,
    onCode: async (code) => {
      try {
        await exchangeCode(code, redirectUri);
        const status = await getAuthStatus();
        onComplete(status);
      } catch (err) {
        onError(err);
      } finally {
        cancelBrowserOAuthFlow();
      }
    },
    onDenied: (reason) => {
      onError(
        new Error(
          reason === 'access_denied' ? 'Autorización cancelada en Spotify' : String(reason),
        ),
      );
      cancelBrowserOAuthFlow();
    },
    onTimeout: (err) => {
      onError(err);
      cancelBrowserOAuthFlow();
    },
  });

  return { url, redirect_uri: redirectUri };
}

async function exchangeCode(code, redirectUri) {
  const cfg = requireOAuthConfig();
  const uri = redirectUri || _pendingRedirectUri;
  const codeVerifier = _pendingCodeVerifier;
  if (!uri || !codeVerifier) throw new Error('Flujo OAuth no iniciado');
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    redirect_uri: uri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetchWithRetry(TOKEN_URL, { method: 'POST', body }, { retries: 0, provider: 'spotify' });
  if (!res.ok) {
    const errBody = await res.text();
    if (_isInvalidGrant(errBody)) throw new Error(REAUTH_REQUIRED_MESSAGE);
    throw new Error(`Error OAuth de Spotify: ${errBody}`);
  }
  const data = await res.json();
  if (!data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw new Error(
      'Spotify no devolvió un refresh token. Revoca el acceso en spotify.com/account/apps y vuelve a conectar.',
    );
  }
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope,
  };
  saveTokens(tokens);
  return tokens;
}

async function getAuthStatus() {
  let tokens;
  try {
    tokens = await getValidTokens();
  } catch {
    return { authenticated: false };
  }
  if (!tokens) return { authenticated: false };
  try {
    const res = await fetchWithRetry(
      `${API_BASE}/me`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      { provider: 'spotify' },
    );
    if (!res.ok) return { authenticated: false };
    const me = await res.json();
    return {
      authenticated: true,
      id: me.id || undefined,
      display_name: me.display_name || undefined,
      product: me.product || undefined,
    };
  } catch {
    return { authenticated: false };
  }
}

async function revokeAuth() {
  cancelBrowserOAuthFlow();
  // Spotify no expone endpoint de revocación: borrar tokens locales y el usuario
  // revoca el acceso en spotify.com/account/apps si lo desea.
  clearTokens();
  return { success: true };
}

module.exports = {
  API_BASE,
  SCOPES,
  REAUTH_REQUIRED_MESSAGE,
  getOAuthConfigStatus,
  saveOAuthConfig,
  requireOAuthConfig,
  getValidTokens,
  forceRefreshTokens,
  refreshAccessToken,
  clearTokens,
  beginBrowserOAuthFlow,
  cancelBrowserOAuthFlow,
  exchangeCode,
  getAuthStatus,
  revokeAuth,
};
