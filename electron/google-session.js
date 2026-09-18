const store = require('./autoimg-user-store');
const { maskClientId, validateClientId } = require('./autoimg-security');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const {
  getActiveUserSnapshot,
  isActiveUserSnapshotCurrent,
} = require('./autoimg-user-scope');

const REAUTH_REQUIRED_MESSAGE =
  'La sesión de Google expiró o fue revocada. Vuelve a conectar tu cuenta con "Conectar con Google".';
const SESSION_CHANGED_MESSAGE = 'La sesión de Google cambió durante la operación.';

const _tokenRefreshPromises = new Map();

function isInvalidGrantResponse(body) {
  const text = String(body || '');
  return /invalid_grant/i.test(text) || /Token has been expired or revoked/i.test(text);
}

function _normalizeOAuthConfig(config) {
  return {
    clientId: String(config.clientId || '').trim(),
    clientSecret: String(config.clientSecret || '').trim(),
  };
}

function getOAuthConfig() {
  const fromEnv = _normalizeOAuthConfig({
    clientId: process.env.AUTOIMG_GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.AUTOIMG_GOOGLE_CLIENT_SECRET || '',
  });
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;
  return _normalizeOAuthConfig(store.loadOAuthConfigFromDisk());
}

function saveOAuthConfig(clientId, clientSecret) {
  return store.saveOAuthConfig(clientId, clientSecret);
}

function getOAuthConfigStatus() {
  const config = getOAuthConfig();
  const configured = Boolean(config.clientId && config.clientSecret);
  return {
    configured,
    client_id_masked: configured ? maskClientId(config.clientId) : undefined,
  };
}

function requireOAuthConfig() {
  const config = getOAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      'Credenciales OAuth no configuradas. En AutoIMG, abre el apartado "Credenciales OAuth" e ingresa tu Client ID y Client Secret de Google Cloud.',
    );
  }
  validateClientId(config.clientId);
  return config;
}

function captureAuthSession() {
  if (typeof getActiveUserSnapshot === 'function') return getActiveUserSnapshot();
  return { userKey: null, generation: 0 };
}

function isAuthSessionCurrent(session) {
  if (typeof isActiveUserSnapshotCurrent === 'function') {
    return isActiveUserSnapshotCurrent(session);
  }
  return true;
}

function sessionStoreKey(session) {
  return session?.userKey || 'anonymous';
}

function clearSessionTokens(session = captureAuthSession()) {
  store.clearTokensForUserKey(sessionStoreKey(session));
}

function assertAuthSessionCurrent(session) {
  if (!isAuthSessionCurrent(session)) throw new Error(SESSION_CHANGED_MESSAGE);
}

async function _refreshAccessToken(tokens, session = captureAuthSession()) {
  assertAuthSessionCurrent(session);
  const config = requireOAuthConfig();
  if (!tokens?.refresh_token) {
    clearSessionTokens(session);
    throw new Error(REAUTH_REQUIRED_MESSAGE);
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetchWithRetry(
    'https://oauth2.googleapis.com/token',
    { method: 'POST', body },
    { retries: 0 },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    if (isInvalidGrantResponse(errorBody)) {
      clearSessionTokens(session);
      throw new Error(REAUTH_REQUIRED_MESSAGE);
    }
    throw new Error(`No se pudo refrescar el token: ${errorBody}`);
  }
  const data = await response.json();
  const updated = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  assertAuthSessionCurrent(session);
  store.saveTokensForUserKey(sessionStoreKey(session), updated);
  return updated;
}

function refreshAccessToken(tokens, session = captureAuthSession()) {
  const refreshToken = tokens?.refresh_token;
  if (!refreshToken) return _refreshAccessToken(tokens, session);

  assertAuthSessionCurrent(session);
  const key = `${sessionStoreKey(session)}:${session.generation}:${refreshToken}`;
  const pending = _tokenRefreshPromises.get(key);
  if (pending) return pending;

  const request = _refreshAccessToken(tokens, session).finally(() => {
    if (_tokenRefreshPromises.get(key) === request) {
      _tokenRefreshPromises.delete(key);
    }
  });
  _tokenRefreshPromises.set(key, request);
  return request;
}

async function getValidTokens(expectedSession) {
  const session = expectedSession || captureAuthSession();
  let tokens = store.loadTokens();
  if (!tokens || !isAuthSessionCurrent(session)) return null;

  const hasAccess = Boolean(tokens.access_token);
  const hasRefresh = Boolean(tokens.refresh_token);
  if (!hasAccess && !hasRefresh) return null;

  const expiresSoon = !tokens.expiry_date || tokens.expiry_date < Date.now() + 60_000;
  if (!hasAccess || expiresSoon) {
    if (!hasRefresh) {
      clearSessionTokens(session);
      return null;
    }
    try {
      tokens = await refreshAccessToken(tokens, session);
    } catch (error) {
      if (error instanceof Error && (
        error.message === REAUTH_REQUIRED_MESSAGE
        || error.message === SESSION_CHANGED_MESSAGE
      )) {
        return null;
      }
      throw error;
    }
  }
  return isAuthSessionCurrent(session) ? tokens : null;
}

module.exports = {
  getOAuthConfig,
  getOAuthConfigStatus,
  saveOAuthConfig,
  requireOAuthConfig,
  captureAuthSession,
  isAuthSessionCurrent,
  sessionStoreKey,
  assertAuthSessionCurrent,
  getValidTokens,
  refreshAccessToken,
  isInvalidGrantResponse,
  REAUTH_REQUIRED_MESSAGE,
};
