const http = require('http');
const { assertOrExit: assert } = require('./helpers/harness');
const {
  beginBrowserOAuthFlow,
  createPendingFlow,
  wireBrowserCallbackServer,
} = require('../electron/oauth-session');
const { findAvailablePort } = require('../electron/autoimg-oauth-flow');

const probe = (p, path = '/') =>
  new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${p}${path}`, { agent: false }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', (err) => reject(err));
  });

async function main() {
  // Guardia del flujo vigente: cancel detiene el servidor activo y limpia los
  // slots del intento pendiente.
  {
    const pending = createPendingFlow();
    pending.slots.redirectUri = 'http://127.0.0.1:1';
    pending.slots.codeVerifier = 'verifier-viejo';
    pending.slots.state = 'state-viejo';
    let stopped = false;
    const guard = pending.start();
    assert(guard.isCurrent(), 'start marca el flujo como vigente');
    guard.setStop(() => { stopped = true; });
    pending.cancel();
    assert(stopped, 'cancel detiene el servidor del flujo vigente');
    assert(
      pending.slots.redirectUri === null
      && pending.slots.codeVerifier === null
      && pending.slots.state === null,
      'cancel limpia redirect_uri, verifier y state pendientes',
    );
  }

  // Orquestación completa sobre servidores reales: un segundo begin cierra el
  // servidor del intento anterior y el callback vigente entrega code + target
  // a connect y el estado final a onComplete.
  {
    const pending = createPendingFlow();
    const portA = await findAvailablePort();
    const portB = await findAvailablePort(portA + 1);
    const targets = [
      { port: portA, redirectUri: `http://127.0.0.1:${portA}` },
      { port: portB, redirectUri: `http://127.0.0.1:${portB}` },
    ];
    let next = 0;
    const seen = [];
    let resolveComplete;
    const completed = new Promise((resolve) => { resolveComplete = resolve; });
    const options = {
      label: 'Test',
      resolveTarget: async () => targets[next++],
      buildAuthUrl: (redirectTarget, codeChallenge, state) =>
        `https://auth.example/authorize?redirect_uri=${encodeURIComponent(redirectTarget)}&code_challenge=${codeChallenge}&state=${state}`,
      connect: async (code, target) => {
        seen.push(`connect:${code}`, `target:${target.port}`, `verifier:${pending.slots.codeVerifier}`);
        return { authenticated: true, port: target.port };
      },
      onComplete: (status) => { resolveComplete(status); },
      onError: () => { resolveComplete(null); },
    };

    const first = await beginBrowserOAuthFlow(pending, options);
    assert(first.redirect_uri === targets[0].redirectUri, 'begin devuelve el redirect_uri del primer intento');
    assert(await probe(portA, '/ruta-desconocida') === 404, 'el primer intento deja su servidor vivo');

    const { url, redirect_uri: redirectUri } = await beginBrowserOAuthFlow(pending, options);
    assert(url.includes(`redirect_uri=${encodeURIComponent(targets[1].redirectUri)}`), 'begin construye la URL del proveedor con el redirect vigente');
    assert(url.includes('code_challenge=') && url.includes('state='), 'begin incluye PKCE y state en la URL');
    assert(redirectUri === targets[1].redirectUri, 'begin devuelve el redirect_uri del intento vigente');
    assert(pending.slots.redirectUri === redirectUri, 'begin guarda el redirect_uri pendiente');
    assert(pending.slots.codeVerifier && pending.slots.state, 'begin guarda verifier y state pendientes');

    let refused = null;
    try {
      await probe(portA);
    } catch {
      refused = true;
    }
    assert(refused, 'el segundo begin cerró el servidor del intento anterior');
    const notFound = await probe(portB, '/ruta-desconocida');
    assert(notFound === 404, 'el servidor del intento vigente responde en su puerto');

    const code = 'CODE-VIGENTE';
    await probe(portB, `/?code=${code}&state=${encodeURIComponent(pending.slots.state)}`);
    const status = await completed;
    assert(
      seen[0] === `connect:${code}` && seen[1] === `target:${portB}`,
      'connect recibe el callback code y el target del intento vigente',
    );
    assert(seen[2].startsWith('verifier:') && seen[2] !== 'verifier:null', 'connect ve el verifier antes de la cancelación');
    assert(status !== null && status.authenticated === true && status.port === portB, 'onComplete recibe el estado devuelto por connect');
    assert(
      pending.slots.redirectUri === null && pending.slots.codeVerifier === null && pending.slots.state === null,
      'el flujo completado limpia los slots pendientes',
    );
    let closedAfterFinish = null;
    try {
      closedAfterFinish = await probe(portB, '/ruta-desconocida');
    } catch {
      closedAfterFinish = 'refused';
    }
    assert(closedAfterFinish === 'refused', 'el servidor se cierra al completar el flujo');
  }

  // State incorrecto: onDenied invalid_state, sin connect ni onComplete.
  {
    const pending = createPendingFlow();
    const port = await findAvailablePort();
    const errors = [];
    await beginBrowserOAuthFlow(pending, {
      label: 'Test',
      resolveTarget: async () => ({ port, redirectUri: `http://127.0.0.1:${port}` }),
      buildAuthUrl: (redirectTarget, codeChallenge, state) =>
        `https://auth.example/authorize?state=${state}`,
      connect: async () => { throw new Error('connect no debe ejecutarse'); },
      onComplete: () => { errors.push('onComplete'); },
      onError: (err) => { errors.push(err instanceof Error ? err.message : String(err)); },
    });
    const statuses = await probe(port, '/?code=CODE&state=falso');
    assert(statuses === 400, 'un state inválido responde 400');
    await new Promise((resolve) => setImmediate(resolve));
    assert(errors.join(',') === 'invalid_state', 'un state inválido niega el flujo sin completarlo');
    assert(
      pending.slots.redirectUri === null && pending.slots.state === null,
      'la denegación limpia los slots pendientes',
    );
  }

  // callbackPath: el armado respeta el path del proveedor y rechaza el resto.
  {
    const pending = createPendingFlow();
    const port = await findAvailablePort();
    const state = 'estado-pendiente';
    const seen = [];
    let resolveComplete;
    const completed = new Promise((resolve) => { resolveComplete = resolve; });
    const guard = pending.start();
    wireBrowserCallbackServer({
      port,
      expectedState: state,
      callbackPath: '/autorizar',
      label: 'Test',
      connect: async (code) => {
        seen.push(`${code}@${port}`);
        return { ok: true };
      },
      onComplete: (status) => { resolveComplete(status); },
      onError: () => { resolveComplete(null); },
      cancel: pending.cancel,
      isCurrent: guard.isCurrent,
      setStop: guard.setStop,
    });
    pending.slots.state = state;
    const wrongPath = await probe(port, '/callback?code=X&falso=1');
    assert(wrongPath === 404, 'un path distinto al callback del proveedor responde 404');
    await probe(port, `/autorizar?code=CODE-CUSTOM&state=${encodeURIComponent(state)}`);
    const status = await completed;
    assert(seen.join(',') === `CODE-CUSTOM@${port}`, 'el callback del path del proveedor llega a connect');
    assert(status !== null && status.ok === true, 'el estado final pasa a onComplete vía callbackPath');
  }

  console.log('[PASS] oauth-session: guard del intento vigente, reemplazo, cancelación y callbackPath.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
