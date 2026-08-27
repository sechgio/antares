const crypto = require('crypto');
const store = require('./autoimg-user-store');
const { maskClientId } = require('./autoimg-security');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const { AUTOIMG_SHEET_TABS, listMissingAutoImgTabs } = require('./autoimg-sheet-rows');
const {
  findAvailablePort,
  startCallbackServer,
  stopCallbackServer,
} = require('./autoimg-oauth-flow');
const {
  setActiveUser,
  clearActiveUser,
  getActiveUserPublic,
  maskEmail,
  onActiveUserChange,
} = require('./autoimg-user-scope');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  // Full Drive (not readonly): required to copy/rename images into a destination folder.
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Mensaje cuando Google invalida el refresh token (revocado, caducado o secret cambiado). */
const REAUTH_REQUIRED_MESSAGE =
  'La sesión de Google expiró o fue revocada. Vuelve a conectar tu cuenta con "Conectar con Google".';

let _pendingRedirectUri = null;
let _pendingCodeVerifier = null;
let _pendingOAuthState = null;
let _oauthFlowPromise = null;
const _tokenRefreshPromises = new Map();

function isInvalidGrantResponse(body) {
  const text = String(body || '');
  return /invalid_grant/i.test(text) || /Token has been expired or revoked/i.test(text);
}

function _generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function _generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function _normalizeOAuthConfig(cfg) {
  return {
    clientId: String(cfg.clientId || '').trim(),
    clientSecret: String(cfg.clientSecret || '').trim(),
  };
}

function _validateClientId(clientId) {
  if (!clientId) return;
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error(
      'Client ID inválido. Debe ser de tipo "Aplicación de escritorio" en Google Cloud y terminar en .apps.googleusercontent.com',
    );
  }
}

let _sheetId = null;
let _sheetMeta = null;

/** Al cambiar de usuario Google, el Sheet en memoria debe re-resolverse desde el almacén scoped. */
onActiveUserChange(() => {
  _sheetId = null;
  _sheetMeta = null;
});

function _loadOAuthConfigFromDisk() {
  // Cifrado, migración plaintext→sealed y paths viven en el store consolidado.
  return store.loadOAuthConfigFromDisk();
}

function getOAuthConfig() {
  const fromEnv = _normalizeOAuthConfig({
    clientId: process.env.AUTOIMG_GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.AUTOIMG_GOOGLE_CLIENT_SECRET || '',
  });
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;
  return _normalizeOAuthConfig(_loadOAuthConfigFromDisk());
}

function saveOAuthConfig(clientId, clientSecret) {
  // Validación y cifrado viven en el store consolidado.
  return store.saveOAuthConfig(clientId, clientSecret);
}

function getOAuthConfigStatus() {
  const cfg = getOAuthConfig();
  const configured = !!(cfg.clientId && cfg.clientSecret);
  return {
    configured,
    client_id_masked: configured ? maskClientId(cfg.clientId) : undefined,
  };
}

function _requireConfig() {
  const cfg = getOAuthConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      'Credenciales OAuth no configuradas. En AutoIMG, abre el apartado "Credenciales OAuth" e ingresa tu Client ID y Client Secret de Google Cloud.',
    );
  }
  _validateClientId(cfg.clientId);
  return cfg;
}

function _clearSessionTokens() {
  store.clearTokens();
}

async function _refreshAccessToken(tokens) {
  const cfg = _requireConfig();
  if (!tokens?.refresh_token) {
    _clearSessionTokens();
    throw new Error(REAUTH_REQUIRED_MESSAGE);
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetchWithRetry(
    'https://oauth2.googleapis.com/token',
    { method: 'POST', body },
    { retries: 0 },
  );
  if (!res.ok) {
    const err = await res.text();
    if (isInvalidGrantResponse(err)) {
      _clearSessionTokens();
      throw new Error(REAUTH_REQUIRED_MESSAGE);
    }
    throw new Error(`No se pudo refrescar el token: ${err}`);
  }
  const data = await res.json();
  const updated = {
    ...tokens,
    access_token: data.access_token,
    // Google may omit refresh_token on refresh; keep the existing one.
    refresh_token: data.refresh_token || tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  store.saveTokens(updated);
  return updated;
}

function _refreshAccessTokenSingleFlight(tokens) {
  const refreshToken = tokens?.refresh_token;
  if (!refreshToken) return _refreshAccessToken(tokens);

  const pending = _tokenRefreshPromises.get(refreshToken);
  if (pending) return pending;

  const request = _refreshAccessToken(tokens).finally(() => {
    if (_tokenRefreshPromises.get(refreshToken) === request) {
      _tokenRefreshPromises.delete(refreshToken);
    }
  });
  _tokenRefreshPromises.set(refreshToken, request);
  return request;
}

async function getValidTokens() {
  let tokens = store.loadTokens();
  if (!tokens) return null;

  const hasAccess = Boolean(tokens.access_token);
  const hasRefresh = Boolean(tokens.refresh_token);
  if (!hasAccess && !hasRefresh) return null;

  const expiresSoon = !tokens.expiry_date || tokens.expiry_date < Date.now() + 60_000;
  const needsRefresh = !hasAccess || expiresSoon;

  if (needsRefresh) {
    if (!hasRefresh) {
      _clearSessionTokens();
      return null;
    }
    try {
      tokens = await _refreshAccessTokenSingleFlight(tokens);
    } catch (err) {
      if (err instanceof Error && err.message === REAUTH_REQUIRED_MESSAGE) {
        return null;
      }
      throw err;
    }
  }
  return tokens;
}

function _buildAuthUrl(redirectUri, codeChallenge, state) {
  const cfg = _requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    // consent forces a new refresh_token (select_account alone often reuses an old grant).
    prompt: 'select_account consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function getAuthUrl() {
  const redirectUri = _pendingRedirectUri || 'http://127.0.0.1:42813';
  const verifier = _pendingCodeVerifier || _generateCodeVerifier();
  // Persistir: exchangeCode debe usar el MISMO verifier que generó el
  // challenge. Sin esto, el flujo legacy producía URLs cuyo PKCE jamás
  // podía completarse (verifier nuevo por llamada, nunca guardado).
  _pendingCodeVerifier = verifier;
  const challenge = _generateCodeChallenge(verifier);
  const state = _pendingOAuthState || crypto.randomBytes(24).toString('base64url');
  _pendingOAuthState = state;
  return _buildAuthUrl(redirectUri, challenge, state);
}

function cancelBrowserOAuthFlow() {
  stopCallbackServer();
  _pendingRedirectUri = null;
  _pendingCodeVerifier = null;
  _pendingOAuthState = null;
  _oauthFlowPromise = null;
}

async function beginBrowserOAuthFlow(onComplete, onError) {
  cancelBrowserOAuthFlow();

  const port = await findAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const codeVerifier = _generateCodeVerifier();
  const codeChallenge = _generateCodeChallenge(codeVerifier);
  const oauthState = crypto.randomBytes(24).toString('base64url');
  _pendingRedirectUri = redirectUri;
  _pendingCodeVerifier = codeVerifier;
  _pendingOAuthState = oauthState;
  const url = _buildAuthUrl(redirectUri, codeChallenge, oauthState);

  _oauthFlowPromise = startCallbackServer(port, {
    expectedState: oauthState,
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
      onError(new Error(reason === 'access_denied' ? 'Autorización cancelada en Google' : String(reason)));
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
  const cfg = _requireConfig();
  const uri = redirectUri || _pendingRedirectUri;
  const codeVerifier = _pendingCodeVerifier;
  if (!uri || !codeVerifier) throw new Error('Flujo OAuth no iniciado');
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: uri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetchWithRetry(
    'https://oauth2.googleapis.com/token',
    { method: 'POST', body },
    { retries: 0 },
  );
  if (!res.ok) {
    const errBody = await res.text();
    if (isInvalidGrantResponse(errBody)) {
      throw new Error(REAUTH_REQUIRED_MESSAGE);
    }
    throw new Error(`Error OAuth: ${errBody}`);
  }
  const data = await res.json();
  const previous = store.loadTokens() || {};
  const tokens = {
    access_token: data.access_token,
    // Re-auth sometimes omits refresh_token; keep prior only if still present in response path.
    // Prefer the new one. If Google omitted it after consent, fall back to previous.
    refresh_token: data.refresh_token || previous.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió un refresh token. Revoca el acceso de la app en myaccount.google.com/permissions y vuelve a conectar.',
    );
  }
  // Resolver la identidad de Google ANTES de persistir: guardar bajo el scope
  // del usuario activo anterior pisaría los tokens de la cuenta conectada
  // previamente (cuenta A al conectar cuenta B). Con el email conocido, el
  // guardado cae directamente en el almacén de la cuenta correcta.
  const email = await _resolveGoogleEmail(tokens.access_token);
  if (!email) {
    throw new Error(
      'No se pudo identificar la cuenta de Google. Verifica tu conexión e intenta conectar de nuevo.',
    );
  }
  setActiveUser(email);
  store.saveTokens(tokens);
  store.clearTokensLegacyPaths();
  return tokens;
}

/** Resuelve el email de la cuenta autorizada sin persistir nada. */
async function _resolveGoogleEmail(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetchWithRetry('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json();
    const email = info && info.email;
    return typeof email === 'string' && email ? email : null;
  } catch {
    return null;
  }
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
    const res = await _apiFetch('https://www.googleapis.com/oauth2/v2/userinfo');
    const info = await res.json();
    const email = info.email || undefined;
    if (email) {
      setActiveUser(email);
      // Ensure tokens live under this user (covers process restart with only tokens loaded)
      store.saveTokens({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
      });
    }
    return {
      authenticated: true,
      email,
      email_masked: email ? maskEmail(email) : undefined,
    };
  } catch {
    return { authenticated: false };
  }
}

async function revokeAuth() {
  cancelBrowserOAuthFlow();
  const tokens = store.loadTokens();
  if (tokens?.access_token) {
    await fetchWithRetry(
      'https://oauth2.googleapis.com/revoke',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(tokens.access_token)}`,
      },
      { retries: 0 },
    ).catch(() => {});
  }
  // Solo tokens del usuario activo. Sheet/carpetas quedan en autoimg/users/<hash>/.
  store.clearTokens();
  clearActiveUser();
  _sheetId = null;
  _sheetMeta = null;
  return { success: true };
}

async function _apiFetch(url, options = {}) {
  const tokens = await getValidTokens();
  if (!tokens) throw new Error('No autenticado con Google. Conecta tu cuenta en AutoIMG.');
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` };
  const res = await fetchWithRetry(url, { ...options, headers });
  if (res.status === 401 && tokens.refresh_token) {
    try {
      const refreshed = await _refreshAccessTokenSingleFlight(tokens);
      headers.Authorization = `Bearer ${refreshed.access_token}`;
      return fetchWithRetry(url, { ...options, headers });
    } catch (err) {
      if (err instanceof Error && err.message === REAUTH_REQUIRED_MESSAGE) {
        throw err;
      }
      throw err;
    }
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API error (${res.status}): ${err}`);
  }
  return res;
}

function parseSheetId(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,128})/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{10,128}$/.test(trimmed)) return trimmed;
  throw new Error('ID de hoja de cálculo inválido');
}

function _getTabNames() {
  return (_sheetMeta?.sheets || []).map((s) => s.properties?.title).filter(Boolean);
}

async function _refreshSheetMeta() {
  if (!_sheetId) return;
  const res = await _apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}?fields=properties.title,sheets.properties`);
  _sheetMeta = await res.json();
}

async function _createSheetTabs(tabNames) {
  if (!_sheetId || !tabNames.length) return;
  await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: tabNames.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    },
  );
}

async function ensureAutoImgTabs() {
  if (!_sheetId) return { created_tabs: [] };
  const missing = listMissingAutoImgTabs(_getTabNames());
  if (!missing.length) return { created_tabs: [] };

  await _createSheetTabs(missing);
  await _refreshSheetMeta();

  for (const tabName of missing) {
    const header = AUTOIMG_SHEET_TABS[tabName];
    if (header?.length) {
      await writeRange(`${tabName}!A1`, [header]);
    }
  }

  return { created_tabs: missing };
}

async function openSpreadsheet(rawId) {
  const sheetId = parseSheetId(rawId);
  if (!sheetId) throw new Error('ID de Sheet inválido');
  const res = await _apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties`);
  const data = await res.json();
  const name = data.properties?.title || '';
  _sheetId = sheetId;
  _sheetMeta = data;
  // Persist locally — survives logout / token revoke / app restart
  store.saveSheetConfig(sheetId, name);
  const { created_tabs } = await ensureAutoImgTabs();
  return {
    success: true,
    sheet_id: sheetId,
    name,
    sheets: _getTabNames(),
    created_tabs,
  };
}

function getStoredSheetConfig() {
  const stored = store.loadSheetConfig();
  return {
    sheet_id: _sheetId || stored.sheet_id || '',
    name: _sheetMeta?.properties?.title || stored.name || '',
    linked: Boolean(_sheetId),
  };
}

async function restorePersistedSheet() {
  if (_sheetId) {
    try {
      await ensureAutoImgTabs();
    } catch {
      /* tab provisioning is best-effort on restore */
    }
    return getStoredSheetConfig();
  }
  const stored = store.loadSheetConfig();
  if (!stored.sheet_id) return getStoredSheetConfig();
  const tokens = await getValidTokens();
  if (!tokens) return getStoredSheetConfig();
  try {
    await openSpreadsheet(stored.sheet_id);
  } catch {
    _sheetId = stored.sheet_id;
  }
  return getStoredSheetConfig();
}

function getSheetId() {
  return _sheetId;
}

function _tabNameFromRange(range) {
  const tab = String(range || '').split('!')[0] || '';
  return tab.replace(/^'+|'+$/g, '');
}

function _tabNameFromResponse(range) {
  const tab = String(range || '').split('!')[0] || '';
  return tab.replace(/^'+|'+$/g, '');
}

function _mapBatchGetResult(ranges, valueRanges) {
  const byRange = Object.fromEntries(ranges.map((range) => [range, []]));
  for (const entry of valueRanges || []) {
    const tab = _tabNameFromResponse(entry.range);
    const key = ranges.find((range) => _tabNameFromRange(range) === tab);
    if (key) byRange[key] = entry.values || [];
  }
  return byRange;
}

async function readRange(range) {
  if (!_sheetId) throw new Error('No hay Sheet abierto. Usa autoimg_sheets_open primero.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}/values/${encoded}`);
  const data = await res.json();
  return { values: data.values || [] };
}

async function readRanges(ranges) {
  if (!_sheetId) throw new Error('No hay Sheet abierto. Usa autoimg_sheets_open primero.');
  if (!ranges.length) return {};
  const qs = new URLSearchParams();
  for (const range of ranges) qs.append('ranges', range);
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}/values:batchGet?${qs.toString()}`,
  );
  const data = await res.json();
  return _mapBatchGetResult(ranges, data.valueRanges);
}

async function writeRange(range, values) {
  if (!_sheetId) throw new Error('No hay Sheet abierto.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}/values/${encoded}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) },
  );
  const data = await res.json();
  return { updated: data.updatedCells || 0 };
}

async function appendRow(range, values) {
  if (!_sheetId) throw new Error('No hay Sheet abierto.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }) },
  );
  const data = await res.json();
  const updatedRange = data.updates?.updatedRange || '';
  const rowMatch = updatedRange.match(/!A(\d+)/);
  return { row: rowMatch ? Number(rowMatch[1]) : 0 };
}

async function batchWriteRanges(updates) {
  if (!_sheetId || !updates.length) return { updated: 0 };
  const data = updates.map((u) => ({
    range: u.range,
    values: u.values,
  }));
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(_sheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    },
  );
  const result = await res.json();
  return { updated: result.totalUpdatedCells || 0 };
}

module.exports = {
  getOAuthConfig,
  getOAuthConfigStatus,
  saveOAuthConfig,
  getAuthUrl,
  beginBrowserOAuthFlow,
  cancelBrowserOAuthFlow,
  exchangeCode,
  getAuthStatus,
  revokeAuth,
  parseSheetId,
  openSpreadsheet,
  getStoredSheetConfig,
  restorePersistedSheet,
  getSheetId,
  readRange,
  readRanges,
  writeRange,
  appendRow,
  batchWriteRanges,
  getValidTokens,
  refreshAccessToken: _refreshAccessTokenSingleFlight,
  ensureAutoImgTabs,
  isInvalidGrantResponse,
  REAUTH_REQUIRED_MESSAGE,
  getActiveUserPublic,
};
