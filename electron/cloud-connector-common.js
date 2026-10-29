'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 50 * 1024 * 1024;
let _overrides = null;

function _deps() {
  return _overrides || {
    session: require('./connections-session'),
    fetch: require('./autoimg-google-fetch').fetchWithRetry,
  };
}

function _httpError(label, res) {
  const retry = res.headers && res.headers.get && res.headers.get('retry-after');
  const message = {
    401: `La autorización de ${label} venció; vuelve a conectar la cuenta en Conexiones`,
    403: `${label} rechazó la operación: la cuenta no tiene acceso a este recurso o faltan permisos`,
    404: `${label} no encontró el recurso o la cuenta no tiene acceso`,
    409: `El recurso ya existe o está en conflicto en ${label}`,
    412: `El recurso cambió en ${label} desde que se consultó; vuelve a leerlo`,
    423: `El recurso está bloqueado en ${label}; ciérralo en otras aplicaciones e inténtalo de nuevo`,
    429: `${label} limitó las solicitudes${retry ? `; espera ${retry} s` : ''} e inténtalo más tarde`,
  }[res.status] || `${label} respondió con el estado ${res.status}`;
  const err = new Error(message);
  err.status = res.status;
  return err;
}

/**
 * Plantilla común del patrón "tokens → Authorization: Bearer → fetch → refresh
 * una sola vez si 401 → reintento". Lo que cada servicio hace distinto se
 * inyecta por callbacks para preservar su comportamiento exacto:
 *
 * - `getTokens()`: obtiene los tokens vigentes del servicio.
 * - `hasAuthToken(tokens)`: decide si el token es utilizable (por defecto
 *   exige `access_token`; google-session solo exige tener tokens).
 * - `missingTokenError()`: construye el error cuando no hay tokens.
 * - `onFetchError(err)`: si se pasa, traduce errores de transporte; si no,
 *   el error original se propaga tal cual.
 * - `assertSessionCurrent()`: si se pasa, se ejecuta tras obtener tokens y
 *   tras cada fetch (sesión Google por usuario activo).
 * - `canRefresh(tokens)` + `refresh(tokens, res)`: refresh único ante 401;
 *   si `refresh` devuelve tokens, se reintenta la petición con el nuevo
 *   Bearer y por última vez (nunca hay un segundo refresh).
 */
async function bearerRequest({
  fetch: fetchImpl,
  url,
  options = {},
  fetchOpts,
  getTokens,
  hasAuthToken = (tokens) => Boolean(tokens && tokens.access_token),
  missingTokenError,
  onFetchError,
  assertSessionCurrent,
  canRefresh,
  refresh,
}) {
  const tokens = await getTokens();
  if (!hasAuthToken(tokens)) throw missingTokenError();
  if (assertSessionCurrent) assertSessionCurrent();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` };
  let res;
  try {
    res = await fetchImpl(url, { ...options, headers }, fetchOpts);
  } catch (err) {
    throw onFetchError ? onFetchError(err) : err;
  }
  if (assertSessionCurrent) assertSessionCurrent();
  if (res.status === 401 && typeof refresh === 'function' && canRefresh(tokens)) {
    const refreshed = await refresh(tokens, res);
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed.access_token}`;
      res = await fetchImpl(url, { ...options, headers }, fetchOpts);
      if (assertSessionCurrent) assertSessionCurrent();
    }
  }
  return res;
}

async function request(provider, label, url, options = {}, { raw = false } = {}) {
  const { session, fetch } = _deps();
  const res = await bearerRequest({
    fetch,
    url,
    options: { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } },
    fetchOpts: { provider: `connections:${provider}`, timeoutMs: 120_000 },
    getTokens: () => session.getValidTokens(provider),
    missingTokenError: () => new Error(`Conecta tu cuenta de ${label} en Conexiones`),
    onFetchError: () => {
      const err = new Error(`Sin respuesta de ${label}`);
      err.transport = true;
      return err;
    },
    // getValidTokens de connections-session ya refresca vía backend antes de
    // devolver tokens: no hay reintento adicional sobre 401.
  });
  if (!res.ok) throw _httpError(label, res);
  if (raw) return res;
  return res.status === 204 ? {} : res.json();
}

/**
 * Handlers del servidor de callback (onCode/onDenied/onTimeout) para un flujo
 * OAuth en navegador. `connect(code)` ejecuta el intercambio y cualquier paso
 * intermedio y devuelve el estado que recibe `onComplete`; `label` es el
 * nombre visible del servicio en "Autorización cancelada en ${label}";
 * `cancel()` limpia el estado del flujo en curso.
 */
function browserOAuthCallbackHandlers({ label, connect, onComplete, onError, cancel }) {
  return {
    onCode: async (code) => {
      try {
        const status = await connect(code);
        onComplete(status);
      } catch (err) {
        onError(err);
      } finally {
        cancel();
      }
    },
    onDenied: (reason) => {
      onError(
        new Error(
          reason === 'access_denied'
            ? `Autorización cancelada en ${label}`
            : String(reason),
        ),
      );
      cancel();
    },
    onTimeout: (err) => {
      onError(err);
      cancel();
    },
  };
}

/**
 * Une el ciclo de vida del servidor de callback con el flujo en curso: guarda
 * `stop` si el flujo sigue vigente (vía `setStop`) o cierra el servidor si fue
 * sustituido por otro arranque; si el arranque falla, notifica y limpia solo
 * si el flujo sigue siendo el actual (`isCurrent`).
 */
function wireOAuthCallbackServer(serverPromise, { isCurrent, setStop, onError, cancel }) {
  serverPromise
    .then(({ stop }) => {
      if (isCurrent()) setStop(stop);
      else stop();
    })
    .catch((err) => {
      if (!isCurrent()) return;
      onError(err);
      cancel();
    });
}

/**
 * Intercambio de código del flujo OAuth en navegador: POST al endpoint de
 * token; `invalid_grant` se traduce al mensaje de reautorización del servicio
 * y se exige un `refresh_token` en la respuesta. El `body` y los `fetchOpts`
 * los arma el servicio para preservar los campos y el orden exactos de cada
 * proveedor; devuelve `data` para que cada servicio construya y persista sus
 * tokens como ya lo hace.
 */
async function exchangeBrowserOAuthCode({
  fetch: fetchImpl,
  tokenUrl,
  body,
  fetchOpts,
  invalidGrant,
  reauthMessage,
  oauthError,
  noRefreshTokenMessage,
}) {
  const res = await fetchImpl(tokenUrl, { method: 'POST', body }, fetchOpts);
  if (!res.ok) {
    const errBody = await res.text();
    if (invalidGrant(errBody)) throw new Error(reauthMessage);
    throw new Error(oauthError(errBody));
  }
  const data = await res.json();
  if (!data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw new Error(noRefreshTokenMessage);
  }
  return data;
}

function accountContext(provider, label, anyOf) {
  const tokens = _deps().session.loadTokens(provider);
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    throw new Error(`Conecta tu cuenta de ${label} en Conexiones antes de usar esta herramienta`);
  }
  const scopes = [...new Set(String(tokens.scope || '').split(/[\s,]+/).filter(Boolean))].sort();
  if (!anyOf.some((need) => scopes.some((scope) => scope === need || scope.endsWith(`/${need}`)))) {
    throw new Error(`Falta el permiso ${anyOf[0]} en ${label}; vuelve a conectar la cuenta en Conexiones`);
  }
  return { account: tokens.account || `Cuenta de ${label}`, scopes };
}

function assertSize(bytes) {
  if (bytes > MAX_BYTES) throw new Error('El archivo excede 50 MiB; el agente no lo transfiere');
}

function _hashes(bytes) {
  const digest = (algorithm) => crypto.createHash(algorithm).update(bytes).digest('hex');
  return { sha256: digest('sha256'), md5: digest('md5'), sha1: digest('sha1') };
}

async function saveDraft(dir, name, bytes) {
  assertSize(bytes.length);
  const safe = String(name || 'archivo').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 150) || 'archivo';
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  await fs.promises.writeFile(target, bytes, { flag: 'wx' });
  return { draft_name: path.basename(target), draft_path: target, size: bytes.length, sha256: _hashes(bytes).sha256 };
}

async function readDraft(dir, name) {
  const value = String(name || '');
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error(`Borrador no válido: ${value}`);
  const root = await fs.promises.realpath(dir).catch(() => null);
  const target = path.join(dir, value);
  const real = root && await fs.promises.realpath(target).catch(() => null);
  if (!real || path.normalize(real).toLowerCase() !== path.normalize(target).toLowerCase()
    || !real.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    throw new Error(`No existe el borrador ${value}`);
  }
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw new Error(`No existe el borrador ${value}`);
  assertSize(stat.size);
  const bytes = await fs.promises.readFile(real);
  return { name: path.basename(real), path: real, bytes, size: bytes.length, ..._hashes(bytes) };
}

async function write(send, verify) {
  try {
    return await send();
  } catch (err) {
    if (!(err.transport || err.status >= 500)) throw err;
    if (verify) {
      try {
        const confirmed = await verify();
        if (confirmed) return { ...confirmed, reconciled: true };
      } catch { }
    }
    const uncertain = new Error(`${err.message}. No se pudo confirmar si el cambio se aplicó; consulta el recurso antes de repetirlo`);
    uncertain.uncertain = true;
    throw uncertain;
  }
}

function matrix(values) {
  if (!Array.isArray(values) || !values.length || values.some((row) => !Array.isArray(row)
    || row.some((cell) => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)))) {
    throw new Error('values debe ser una lista de filas con textos, números o booleanos');
  }
  return values;
}

function sameValues(actual, expected) {
  const norm = (rows) => {
    const out = rows.map((row) => {
      const cells = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      return cells;
    });
    while (out.length && !out[out.length - 1].length) out.pop();
    return JSON.stringify(out);
  };
  return norm(actual || []) === norm(expected || []);
}

module.exports = {
  request, accountContext, assertSize, saveDraft, readDraft, write, matrix, sameValues,
  bearerRequest, browserOAuthCallbackHandlers, wireOAuthCallbackServer, exchangeBrowserOAuthCode,
  _setDeps: (deps) => { _overrides = deps; },
};
