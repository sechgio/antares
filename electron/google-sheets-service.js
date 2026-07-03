const crypto = require('crypto');
const { loadTokens, saveTokens, clearTokens } = require('./autoimg-token-storage');
const { loadSheetConfig, saveSheetConfig, clearSheetConfig } = require('./autoimg-sheet-storage');
const {
  readSecureJson,
  writeSecureJson,
  migratePlaintextJson,
} = require('./autoimg-secure-storage');
const { maskClientId } = require('./autoimg-security');
const { fetchWithRetry } = require('./autoimg-google-fetch');
const {
  findAvailablePort,
  startCallbackServer,
  stopCallbackServer,
} = require('./autoimg-oauth-flow');

const OAUTH_CONFIG_FILE = 'autoimg-oauth-config.json';
const OAUTH_CONFIG_NS = 'oauth';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

let _pendingRedirectUri = null;
let _pendingCodeVerifier = null;
let _oauthFlowPromise = null;

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

function _loadOAuthConfigFromDisk() {
  migratePlaintextJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS, (raw) => (
    typeof raw.client_secret === 'string' || typeof raw.clientSecret === 'string'
  ));
  const cfg = readSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS);
  if (!cfg) return { clientId: '', clientSecret: '' };
  return {
    clientId: cfg.client_id || cfg.clientId || '',
    clientSecret: cfg.client_secret || cfg.clientSecret || '',
  };
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
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || id.length < 12) throw new Error('Client ID inválido');
  _validateClientId(id);
  if (!secret || secret.length < 8) throw new Error('Client Secret inválido');
  writeSecureJson(OAUTH_CONFIG_FILE, OAUTH_CONFIG_NS, { client_id: id, client_secret: secret });
  return { success: true };
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

async function _refreshAccessToken(tokens) {
  const cfg = _requireConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`No se pudo refrescar el token: ${err}`);
  }
  const data = await res.json();
  const updated = { ...tokens, access_token: data.access_token, expiry_date: Date.now() + (data.expires_in || 3600) * 1000 };
  saveTokens(updated);
  return updated;
}

async function getValidTokens() {
  let tokens = loadTokens();
  if (!tokens?.access_token) return null;
  const expiresSoon = !tokens.expiry_date || tokens.expiry_date < Date.now() + 60_000;
  if (expiresSoon && tokens.refresh_token) {
    tokens = await _refreshAccessToken(tokens);
  }
  return tokens;
}

function _buildAuthUrl(redirectUri, codeChallenge) {
  const cfg = _requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function getAuthUrl() {
  const redirectUri = _pendingRedirectUri || 'http://127.0.0.1:42813';
  const verifier = _pendingCodeVerifier || _generateCodeVerifier();
  const challenge = _generateCodeChallenge(verifier);
  return _buildAuthUrl(redirectUri, challenge);
}

function cancelBrowserOAuthFlow() {
  stopCallbackServer();
  _pendingRedirectUri = null;
  _pendingCodeVerifier = null;
  _oauthFlowPromise = null;
}

async function beginBrowserOAuthFlow(onComplete, onError) {
  cancelBrowserOAuthFlow();

  const port = await findAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const codeVerifier = _generateCodeVerifier();
  const codeChallenge = _generateCodeChallenge(codeVerifier);
  _pendingRedirectUri = redirectUri;
  _pendingCodeVerifier = codeVerifier;
  const url = _buildAuthUrl(redirectUri, codeChallenge);

  _oauthFlowPromise = startCallbackServer(port, {
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
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!res.ok) throw new Error(`Error OAuth: ${await res.text()}`);
  const data = await res.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function getAuthStatus() {
  const tokens = await getValidTokens();
  if (!tokens) return { authenticated: false };
  try {
    const res = await _apiFetch('https://www.googleapis.com/oauth2/v2/userinfo');
    const info = await res.json();
    return { authenticated: true, email: info.email || undefined };
  } catch {
    return { authenticated: false };
  }
}

async function revokeAuth() {
  cancelBrowserOAuthFlow();
  const tokens = loadTokens();
  if (tokens?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: 'POST' }).catch(() => {});
  }
  clearTokens();
  clearSheetConfig();
  _sheetId = null;
  _sheetMeta = null;
  return { success: true };
}

async function _apiFetch(url, options = {}) {
  const tokens = await getValidTokens();
  if (!tokens) throw new Error('No autenticado con Google');
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` };
  const res = await fetchWithRetry(url, { ...options, headers });
  if (res.status === 401 && tokens.refresh_token) {
    const refreshed = await _refreshAccessToken(tokens);
    headers.Authorization = `Bearer ${refreshed.access_token}`;
    return fetchWithRetry(url, { ...options, headers });
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
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

async function openSpreadsheet(rawId) {
  const sheetId = parseSheetId(rawId);
  if (!sheetId) throw new Error('ID de Sheet inválido');
  const res = await _apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties`);
  const data = await res.json();
  const name = data.properties?.title || '';
  _sheetId = sheetId;
  _sheetMeta = data;
  saveSheetConfig(sheetId, name);
  return {
    success: true,
    sheet_id: sheetId,
    name,
    sheets: (data.sheets || []).map((s) => s.properties?.title).filter(Boolean),
  };
}

function getStoredSheetConfig() {
  const stored = loadSheetConfig();
  return {
    sheet_id: _sheetId || stored.sheet_id || '',
    name: _sheetMeta?.properties?.title || stored.name || '',
    linked: Boolean(_sheetId),
  };
}

async function restorePersistedSheet() {
  if (_sheetId) return getStoredSheetConfig();
  const stored = loadSheetConfig();
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

function setSheetId(id) {
  _sheetId = id;
}

async function readRange(range) {
  if (!_sheetId) throw new Error('No hay Sheet abierto. Usa autoimg_sheets_open primero.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${_sheetId}/values/${encoded}`);
  const data = await res.json();
  return { values: data.values || [] };
}

async function writeRange(range, values) {
  if (!_sheetId) throw new Error('No hay Sheet abierto.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_sheetId}/values/${encoded}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) },
  );
  const data = await res.json();
  return { updated: data.updatedCells || 0 };
}

async function appendRow(range, values) {
  if (!_sheetId) throw new Error('No hay Sheet abierto.');
  const encoded = encodeURIComponent(range);
  const res = await _apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_sheetId}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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
    `https://sheets.googleapis.com/v4/spreadsheets/${_sheetId}/values:batchUpdate`,
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
  setSheetId,
  readRange,
  writeRange,
  appendRow,
  batchWriteRanges,
  getValidTokens,
};