'use strict';

/**
 * Catálogo de proveedores conectables (shared/connections-catalog.json).
 * Cada spec declara cómo autorizar, canjear y sondear el estado; el backend
 * Python consume el mismo documento para refrescar tokens en los flujos.
 */

const catalog = require('../shared/connections-catalog.json');

const AUTH_TYPES = new Set(['oauth_secret', 'oauth_pkce']);

function _normalizeSpec(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const auth = raw.auth || {};
  if (!AUTH_TYPES.has(auth.type)) return null;
  if (typeof auth.authorize_url !== 'string' || typeof auth.token_url !== 'string') return null;
  const scopes = Array.isArray(auth.scopes) ? auth.scopes.filter((s) => typeof s === 'string') : [];
  return {
    id,
    label: String(raw.label || id),
    description: String(raw.description || ''),
    docs: typeof raw.docs === 'string' ? raw.docs : '',
    auth: {
      type: auth.type,
      authorize_url: auth.authorize_url,
      token_url: auth.token_url,
      token_auth: auth.token_auth === 'basic' ? 'basic' : 'form',
      scopes,
      callback_port: Number(auth.callback_port) > 0 ? Number(auth.callback_port) : 42831,
      callback_path: typeof auth.callback_path === 'string' && auth.callback_path.startsWith('/')
        ? auth.callback_path
        : '/callback',
      requires_client_secret: auth.requires_client_secret !== false,
      extra_authorize: auth.extra_authorize && typeof auth.extra_authorize === 'object' ? auth.extra_authorize : {},
      extra_token: auth.extra_token && typeof auth.extra_token === 'object' ? auth.extra_token : {},
    },
    status: raw.status && typeof raw.status === 'object' && typeof raw.status.url === 'string'
      ? {
          url: raw.status.url,
          account_field: typeof raw.status.account_field === 'string' ? raw.status.account_field : '',
          headers: raw.status.headers && typeof raw.status.headers === 'object' ? raw.status.headers : {},
        }
      : null,
  };
}

let _cache = null;

function listProviders() {
  if (_cache === null) {
    _cache = {};
    const providers = catalog && catalog.providers;
    if (providers && typeof providers === 'object') {
      for (const [id, raw] of Object.entries(providers)) {
        const spec = _normalizeSpec(id, raw);
        if (spec) _cache[id] = spec;
      }
    }
  }
  return Object.values(_cache);
}

function getProvider(id) {
  const spec = listProviders().find((p) => p.id === id);
  if (!spec) {
    const err = new Error(`Proveedor de conexión desconocido: ${id}`);
    err.code = 'unknown_provider';
    throw err;
  }
  return spec;
}

function hasProvider(id) {
  return listProviders().some((p) => p.id === id);
}

module.exports = { listProviders, getProvider, hasProvider };
