'use strict';

/**
 * Sesión OAuth genérica por proveedor de conexión (Flujos → Conexiones).
 *
 * Generaliza el patrón de spotify-session/google-session: config y tokens por
 * proveedor en secure-storage, loopback 127.0.0.1 + state (+ PKCE si el spec lo
 * pide) y canje de código según `auth.type` del catálogo compartido.
 *
 * Tras cada alta/refresco se espeja el token al vault del backend
 * (`flows_connection_token_*`) para que los nodos http_request puedan firmar
 * con `connection_ref`; las claves nunca salen de los vaults cifrados.
 */

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
} = require('./autoimg-oauth-flow');
const { getProvider } = require('./connections-providers');

const _pending = new Map(); // provider -> { redirectUri, codeVerifier, stop }
const _tokenCache = new Map(); // provider -> tokens | null
const _refreshPromises = new Map(); // provider -> Promise

function _oauthConfigFile(providerId) {
  return `connections/${providerId}-oauth-config.json`;
}
function _oauthConfigNs(providerId) {
  return `connections:${providerId}:oauth`;
}
function _tokensFile(providerId) {
  return `connections/${providerId}-tokens.json`;
}
function _tokensNs(providerId) {
  return `connections:${providerId}:tokens`;
}

function _mirrorToBackend(provider, tokens, cfg) {
  if (!tokens || !tokens.access_token) return;
  try {
    require('./ipc-router')
      ._callBackend('flows_connection_token_put', {
        provider,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
          scope: tokens.scope,
          account: tokens.account,
          client_id: cfg ? cfg.clientId : undefined,
          client_secret: cfg ? cfg.clientSecret : undefined,
        },
      })
      .catch((err) => {
        require('./app-log').appendLogEvent('WARN', 'connections.mirror_failed', {
          provider,
          reason: String((err && err.message) || err).slice(0, 200),
        });
      });
  } catch (err) {
    console.warn(`[connections] espejo de token no disponible: ${err.message}`);
  }
}

function _mirrorDelete(provider) {
  try {
    require('./ipc-router')
      ._callBackend('flows_connection_token_delete', { provider })
      .catch(() => {});
  } catch {}
}

function loadOAuthConfig(provider) {
  const cfg = readSecureJson(_oauthConfigFile(provider), _oauthConfigNs(provider));
  return {
    clientId: String((cfg && cfg.client_id) || '').trim(),
    clientSecret: String((cfg && cfg.client_secret) || '').trim(),
  };
}

function oauthConfigStatus(provider) {
  const cfg = loadOAuthConfig(provider);
  return {
    configured: Boolean(cfg.clientId),
    client_id_masked: cfg.clientId ? maskClientId(cfg.clientId) : undefined,
  };
}

function saveOAuthConfig(provider, clientId, clientSecret) {
  const spec = getProvider(provider);
  const id = String(clientId || '').trim();
  if (!id) {
    throw new Error(`Client ID requerido. Consíguelo en ${spec.docs || 'el panel de desarrolladores del proveedor'}.`);
  }
  const secret = String(clientSecret || '').trim();
  if (spec.auth.requires_client_secret && !secret) {
    throw new Error(`${spec.label} necesita también el Client Secret de tu app.`);
  }
  const previous = loadOAuthConfig(provider);
  if (previous.clientId && previous.clientId !== id) {
    _clearTokens(provider);
    _mirrorDelete(provider);
  }
  writeSecureJson(_oauthConfigFile(provider), _oauthConfigNs(provider), {
    client_id: id,
    ...(secret ? { client_secret: secret } : {}),
  });
  return { success: true, configured: true };
}

function requireOAuthConfig(provider) {
  const spec = getProvider(provider);
  const cfg = loadOAuthConfig(provider);
  if (!cfg.clientId) {
    throw new Error(
      `Credenciales de ${spec.label} no configuradas. En Flujos → Conexiones guarda el Client ID de tu app.`,
    );
  }
  return cfg;
}

function _safeTokens(tokens) {
  return {
    access_token: tokens && tokens.access_token,
    refresh_token: tokens && tokens.refresh_token,
    expiry_date: tokens && tokens.expiry_date,
    scope: tokens && tokens.scope,
    account: tokens && tokens.account,
  };
}

function loadTokens(provider) {
  if (!_tokenCache.has(provider)) {
    _tokenCache.set(provider, readSecureJson(_tokensFile(provider), _tokensNs(provider)));
  }
  const cached = _tokenCache.get(provider);
  return cached ? { ...cached } : cached;
}

function _saveTokens(provider, tokens) {
  const safe = _safeTokens(tokens);
  writeSecureJson(_tokensFile(provider), _tokensNs(provider), safe);
  _tokenCache.set(provider, { ...safe });
  _mirrorToBackend(provider, safe, loadOAuthConfig(provider));
  return safe;
}

function _clearTokens(provider) {
  clearSecureJson(_tokensFile(provider));
  _tokenCache.set(provider, null);
}

function _isInvalidGrant(body) {
  return /invalid_grant|invalid_client/i.test(String(body || ''));
}

async function _postToken(provider, fields, cfg, basic) {
  const spec = getProvider(provider);
  const headers = { Accept: 'application/json' };
  if (basic) {
    headers.Authorization = `Basic ${Buffer.from(`${basic.clientId}:${basic.clientSecret}`).toString('base64')}`;
  }
  const res = await fetchWithRetry(
    spec.auth.token_url,
    { method: 'POST', headers, body: new URLSearchParams(fields) },
    { retries: 0, provider: `connections:${provider}` },
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Respuesta no JSON del endpoint de token de ${spec.label}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    if (_isInvalidGrant(text)) {
      _clearTokens(provider);
      _mirrorDelete(provider);
      throw new Error(`La autorización de ${spec.label} fue revocada o expiró; vuelve a conectar la cuenta.`);
    }
    throw new Error(`Error OAuth de ${spec.label}: ${text.slice(0, 300)}`);
  }
  if (!data || !data.access_token) {
    throw new Error(`${spec.label} no devolvió un access_token utilizable.`);
  }
  return data;
}

async function _refreshTokens(provider, tokens) {
  const spec = getProvider(provider);
  const cfg = requireOAuthConfig(provider);
  if (!tokens || !tokens.refresh_token) {
    _clearTokens(provider);
    _mirrorDelete(provider);
    throw new Error(`La conexión con ${spec.label} requiere reautenticación.`);
  }
  const basic = spec.auth.token_auth === 'basic' && cfg.clientSecret
    ? { clientId: cfg.clientId, clientSecret: cfg.clientSecret }
    : null;
  const fields = {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: cfg.clientId,
    ...(basic ? {} : cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    ...spec.auth.extra_token,
  };
  const data = await _postToken(provider, fields, cfg, basic);
  return _saveTokens(provider, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope || tokens.scope,
    account: tokens.account,
  });
}

function refreshTokens(provider, tokens) {
  const pending = _refreshPromises.get(provider);
  if (pending) return pending;
  const p = _refreshTokens(provider, tokens || loadTokens(provider)).finally(() => {
    _refreshPromises.delete(provider);
  });
  _refreshPromises.set(provider, p);
  return p;
}

async function getValidTokens(provider) {
  let tokens = loadTokens(provider);
  if (!tokens) return null;
  if (!tokens.access_token && !tokens.refresh_token) return null;
  // Sin expiry_date (tokens no caducables, p. ej. GitHub) el access_token se usa tal cual.
  const expiresSoon = Boolean(tokens.expiry_date) && tokens.expiry_date < Date.now() + 60_000;
  if ((!tokens.access_token || expiresSoon) && tokens.refresh_token) {
    try {
      tokens = await refreshTokens(provider, tokens);
    } catch {
      return null;
    }
  } else if (!tokens.access_token) {
    return null;
  }
  return tokens;
}

function _generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function _generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function cancelConnect(provider) {
  const pending = _pending.get(provider);
  if (pending && pending.stop) pending.stop();
  _pending.delete(provider);
}

async function beginConnect(provider, onComplete, onError) {
  cancelConnect(provider);
  const spec = getProvider(provider);
  const cfg = requireOAuthConfig(provider);

  const port = await findAvailablePort(spec.auth.callback_port);
  const redirectUri = `http://127.0.0.1:${port}${spec.auth.callback_path}`;
  const usePkce = spec.auth.type === 'oauth_pkce';
  const codeVerifier = usePkce ? _generateCodeVerifier() : null;
  const oauthState = crypto.randomBytes(24).toString('base64url');
  const entry = { redirectUri, codeVerifier, stop: null };
  _pending.set(provider, entry);

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: oauthState,
  });
  if (spec.auth.scopes.length) params.set('scope', spec.auth.scopes.join(' '));
  for (const [k, v] of Object.entries(spec.auth.extra_authorize)) {
    params.set(k, String(v));
  }
  if (usePkce) {
    params.set('code_challenge', _generateCodeChallenge(codeVerifier));
    params.set('code_challenge_method', 'S256');
  }
  const url = `${spec.auth.authorize_url}?${params.toString()}`;

  startCallbackServer(port, {
    expectedState: oauthState,
    callbackPath: spec.auth.callback_path,
    onCode: async (code) => {
      try {
        const tokens = await _exchangeCode(provider, code);
        await probeAccount(provider);
        const status = await getStatus(provider);
        onComplete({ ...status, connected: Boolean(tokens) });
      } catch (err) {
        onError(err);
      } finally {
        cancelConnect(provider);
      }
    },
    onDenied: (reason) => {
      onError(
        new Error(
          reason === 'access_denied'
            ? `Autorización cancelada en ${spec.label}`
            : String(reason),
        ),
      );
      cancelConnect(provider);
    },
    onTimeout: (err) => {
      onError(err);
      cancelConnect(provider);
    },
  })
    .then(({ stop }) => {
      if (_pending.get(provider) === entry) {
        entry.stop = stop;
      } else {
        stop();
      }
    })
    .catch((err) => {
      if (_pending.get(provider) !== entry) return;
      onError(err);
      cancelConnect(provider);
    });

  return { url, redirect_uri: redirectUri };
}

async function _exchangeCode(provider, code) {
  const spec = getProvider(provider);
  const cfg = requireOAuthConfig(provider);
  const pending = _pending.get(provider) || {};
  const uri = pending.redirectUri;
  if (!uri) throw new Error('Flujo OAuth no iniciado');
  const basic = spec.auth.token_auth === 'basic' && cfg.clientSecret
    ? { clientId: cfg.clientId, clientSecret: cfg.clientSecret }
    : null;
  const fields = {
    code,
    client_id: cfg.clientId,
    redirect_uri: uri,
    grant_type: 'authorization_code',
    ...(basic ? {} : cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    ...(pending.codeVerifier ? { code_verifier: pending.codeVerifier } : {}),
    ...spec.auth.extra_token,
  };
  const data = await _postToken(provider, fields, cfg, basic);
  return _saveTokens(provider, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    scope: data.scope || spec.auth.scopes.join(' '),
  });
}

async function probeAccount(provider) {
  const spec = getProvider(provider);
  if (!spec.status) return null;
  const tokens = await getValidTokens(provider);
  if (!tokens || !tokens.access_token) return null;
  const headers = { Accept: 'application/json', ...(spec.status.headers || {}) };
  headers.Authorization = `Bearer ${tokens.access_token}`;
  try {
    const res = await fetchWithRetry(
      spec.status.url,
      { headers },
      { retries: 0, provider: `connections:${provider}` },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const account = spec.status.account_field ? body[spec.status.account_field] : undefined;
    if (account) {
      const tokensNow = loadTokens(provider);
      if (tokensNow && tokensNow.account !== String(account)) {
        _saveTokens(provider, { ...tokensNow, account: String(account) });
      }
    }
    return String(account || 'Cuenta conectada');
  } catch {
    return null;
  }
}

async function getStatus(provider) {
  const spec = getProvider(provider);
  const cfg = oauthConfigStatus(provider);
  const tokens = loadTokens(provider);
  const connected = Boolean(tokens && tokens.access_token);
  return {
    provider,
    configured: cfg.configured,
    client_id_masked: cfg.client_id_masked,
    connected,
    account: connected ? (tokens.account || null) : null,
    expiry_date: tokens ? tokens.expiry_date || null : null,
    scope: tokens ? tokens.scope || null : null,
    auth_type: spec.auth.type,
    redirect_hint: `http://127.0.0.1:${spec.auth.callback_port}${spec.auth.callback_path}`,
  };
}

async function disconnect(provider) {
  cancelConnect(provider);
  _clearTokens(provider);
  _mirrorDelete(provider);
  return { success: true };
}

module.exports = {
  oauthConfigStatus,
  saveOAuthConfig,
  loadOAuthConfig,
  loadTokens,
  getValidTokens,
  refreshTokens,
  beginConnect,
  cancelConnect,
  probeAccount,
  getStatus,
  disconnect,
};
