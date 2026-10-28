const { fetchWithRetry } = require('./autoimg-google-fetch');
const { bearerRequest } = require('./cloud-connector-common');
const {
  captureAuthSession,
  assertAuthSessionCurrent,
  getValidTokens,
  refreshAccessToken,
} = require('./google-session');

async function googleApiFetch(
  url,
  options = {},
  { session = captureAuthSession(), authErrorMessage = 'No autenticado con Google', fetchOpts } = {},
) {
  return bearerRequest({
    fetch: fetchWithRetry,
    url,
    options,
    fetchOpts,
    getTokens: () => getValidTokens(session),
    hasAuthToken: (tokens) => Boolean(tokens),
    missingTokenError: () => new Error(authErrorMessage),
    assertSessionCurrent: () => assertAuthSessionCurrent(session),
    canRefresh: (tokens) => Boolean(tokens.refresh_token),
    refresh: (tokens) => refreshAccessToken(tokens, session),
  });
}

module.exports = { googleApiFetch };
