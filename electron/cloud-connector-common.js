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

async function request(provider, label, url, options = {}, { raw = false } = {}) {
  const { session, fetch } = _deps();
  const tokens = await session.getValidTokens(provider);
  if (!tokens || !tokens.access_token) throw new Error(`Conecta tu cuenta de ${label} en Conexiones`);
  const headers = { Accept: 'application/json', ...(options.headers || {}), Authorization: `Bearer ${tokens.access_token}` };
  let res;
  try {
    res = await fetch(url, { ...options, headers }, { provider: `connections:${provider}`, timeoutMs: 120_000 });
  } catch {
    const err = new Error(`Sin respuesta de ${label}`);
    err.transport = true;
    throw err;
  }
  if (!res.ok) throw _httpError(label, res);
  if (raw) return res;
  return res.status === 204 ? {} : res.json();
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
  _setDeps: (deps) => { _overrides = deps; },
};
