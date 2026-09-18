const { fetchWithRetry } = require('./autoimg-google-fetch');
const {
  captureAuthSession,
  assertAuthSessionCurrent,
  getValidTokens,
  refreshAccessToken,
} = require('./google-session');

// Authenticated Google API request: bearer header, one refresh-and-retry on
// 401, session asserts around each flight. Callers own status/body handling.
async function googleApiFetch(
  url,
  options = {},
  { session = captureAuthSession(), authErrorMessage = 'No autenticado con Google', fetchOpts } = {},
) {
  const tokens = await getValidTokens(session);
  if (!tokens) throw new Error(authErrorMessage);
  assertAuthSessionCurrent(session);
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` };
  let res = await fetchWithRetry(url, { ...options, headers }, fetchOpts);
  assertAuthSessionCurrent(session);
  if (res.status === 401 && tokens.refresh_token) {
    const refreshed = await refreshAccessToken(tokens, session);
    headers.Authorization = `Bearer ${refreshed.access_token}`;
    res = await fetchWithRetry(url, { ...options, headers }, fetchOpts);
    assertAuthSessionCurrent(session);
  }
  return res;
}

module.exports = { googleApiFetch };
