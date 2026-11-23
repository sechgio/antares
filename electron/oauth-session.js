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
