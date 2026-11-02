'use strict';

const crypto = require('crypto');
const {
  findAvailablePort,
  startCallbackServer,
  generateCodeVerifier,
  generateCodeChallenge,
} = require('./autoimg-oauth-flow');
const {
  browserOAuthCallbackHandlers,
  wireOAuthCallbackServer,
} = require('./cloud-connector-common');

/**
 * Piezas compartidas de los flujos OAuth en navegador (google-sheets-service
 * y spotify-session comparten la orquestación completa; connections-session
 * adopta solo el armado del servidor de callback).
 *
 * - `createPendingFlow()`: estado del intento en curso (redirect_uri, PKCE y
 *   state pendientes, más el guardia del servidor vivo) con su cancelación.
 * - `beginBrowserOAuthFlow()`: cancela el intento anterior, resuelve
 *   puerto/redirect_uri del proveedor, genera PKCE + state, construye la URL
 *   y une el ciclo de vida del servidor con el intento vigente.
 * - `wireBrowserCallbackServer()`: arma el servidor de callback con los
 *   handlers de navegador compartidos de cloud-connector-common.
 *
 * No se unifica a propósito lo que diverge por proveedor (almacenamiento y
 * refresco de tokens, determinación de estado, revocación, parámetros extras
 * de autorización): la evidencia línea a línea muestra implementaciones
 * distintas para cada servicio.
 */

function createPendingFlow() {
  let callbackFlow = null;
  const slots = { redirectUri: null, codeVerifier: null, state: null };

  function cancel() {
    callbackFlow?.stop?.();
    callbackFlow = null;
    slots.redirectUri = null;
    slots.codeVerifier = null;
    slots.state = null;
  }

  function start() {
    const flow = { stop: null };
    callbackFlow = flow;
    return {
      isCurrent: () => callbackFlow === flow,
      setStop: (stop) => { flow.stop = stop; },
    };
  }

  return { slots, cancel, start };
}

/**
 * Une el armado del servidor (puerto, state esperado, path de callback y
 * handlers de navegador) con el ciclo de vida del intento: `isCurrent`/
 * `setStop` los aporta el guardia del flujo vigente o la custodia por
 * proveedor (mapa de connections-session).
 */
function wireBrowserCallbackServer({
  port,
  expectedState,
  callbackPath,
  label,
  connect,
  onComplete,
  onError,
  cancel,
  isCurrent,
  setStop,
}) {
  wireOAuthCallbackServer(
    startCallbackServer(port, {
      expectedState,
      ...(callbackPath ? { callbackPath } : {}),
      ...browserOAuthCallbackHandlers({ label, connect, onComplete, onError, cancel }),
    }),
    { isCurrent, setStop, onError, cancel },
  );
}

/**
 * Arranque del flujo: `resolveTarget()` (async) aporta `{ port, redirectUri,
 * callbackPath? }` del proveedor; `buildAuthUrl(redirectUri, codeChallenge,
 * oauthState)` arma la URL con los parámetros exactos del proveedor;
 * `connect(code, target)` ejecuta el intercambio y devuelve el estado que
 * recibe `onComplete`. Devuelve `{ url, redirect_uri }`.
 */
async function beginBrowserOAuthFlow(pending, {
  resolveTarget,
  buildAuthUrl,
  connect,
  label,
  onComplete,
  onError,
}) {
  pending.cancel();

  const target = await resolveTarget();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const oauthState = crypto.randomBytes(24).toString('base64url');
  pending.slots.redirectUri = target.redirectUri;
  pending.slots.codeVerifier = codeVerifier;
  pending.slots.state = oauthState;
  const url = buildAuthUrl(target.redirectUri, codeChallenge, oauthState);

  const guard = pending.start();
  wireBrowserCallbackServer({
    port: target.port,
    expectedState: oauthState,
    callbackPath: target.callbackPath,
    label,
    connect: (code) => connect(code, target),
    onComplete,
    onError,
    cancel: pending.cancel,
    isCurrent: guard.isCurrent,
    setStop: guard.setStop,
  });

  return { url, redirect_uri: target.redirectUri };
}

module.exports = {
  createPendingFlow,
  beginBrowserOAuthFlow,
  wireBrowserCallbackServer,
};
