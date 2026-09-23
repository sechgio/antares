const crypto = require('crypto');
const store = require('./autoimg-user-store');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const { AUTOIMG_SHEET_TABS, listMissingAutoImgTabs } = require('./autoimg-sheet-rows');
const {
  getOAuthConfig,
  getOAuthConfigStatus,
  saveOAuthConfig,
  requireOAuthConfig: _requireConfig,
  captureAuthSession: _captureAuthSession,
  isAuthSessionCurrent: _isAuthSessionCurrent,
  sessionStoreKey: _sessionStoreKey,
  getValidTokens,
  refreshAccessToken,
  isInvalidGrantResponse,
  REAUTH_REQUIRED_MESSAGE,
} = require('./google-session');
const { googleApiFetch } = require('./google-api-fetch');
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
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

let _pendingRedirectUri = null;
let _pendingCodeVerifier = null;
let _pendingOAuthState = null;

function _generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function _generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

let _sheetId = null;
let _sheetMeta = null;

onActiveUserChange(() => {
  _sheetId = null;
  _sheetMeta = null;
});

function _buildAuthUrl(redirectUri, codeChallenge, state) {
  const cfg = _requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
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

  startCallbackServer(port, {
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
  if (!data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw new Error(
      'Google no devolvió un refresh token. Revoca el acceso de la app en myaccount.google.com/permissions y vuelve a conectar.',
    );
  }
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  const email = await _resolveGoogleEmail(tokens.access_token);
  if (!email) {
    throw new Error(
      'No se pudo identificar la cuenta de Google. Verifica tu conexión e intenta conectar de nuevo.',
    );
  }
  const userKey = setActiveUser(email);
  if (!userKey) {
    throw new Error('No se pudo establecer el scope de la cuenta de Google.');
  }
  store.saveTokensForUserKey(userKey, tokens);
  store.clearTokensLegacyPaths();
  return tokens;
}

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
  const session = _captureAuthSession();
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
  store.clearTokensForUserKey(_sessionStoreKey(session));
  if (_isAuthSessionCurrent(session)) clearActiveUser();
  _sheetId = null;
  _sheetMeta = null;
  return { success: true };
}

async function _apiFetch(url, options = {}) {
  const session = _captureAuthSession();
  const res = await googleApiFetch(url, options, {
    session,
    authErrorMessage: 'No autenticado con Google. Conecta tu cuenta en AutoIMG.',
  });
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
    // Reapertura fallida (token expirado, hoja eliminada o permisos): no marcar
    // _sheetId para que linked sea false y el próximo intento vuelva a abrir.
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
  refreshAccessToken,
  isInvalidGrantResponse,
  REAUTH_REQUIRED_MESSAGE,
  getActiveUserPublic,
};
