'use strict';

/**
 * IPC nativo de Conexiones (Flujos → Conexiones): providers del catálogo
 * compartido + sesión OAuth genérica por proveedor.
 */

const { nativeMethods } = require('../shared/ipc-method-catalog');
const session = require('./connections-session');
const { listProviders, listCategories } = require('./connections-providers');
const { emit } = require('./autoimg-notify');

const CONNECTIONS_METHODS = nativeMethods('connections');

function _sanitizeError(err) {
  if (err instanceof Error) {
    const wrapped = new Error(`ConnectionsError: ${String(err.message || '').slice(0, 300)}`);
    wrapped.code = err.code;
    return wrapped;
  }
  return new Error(`ConnectionsError: ${String(err).slice(0, 300)}`);
}

async function handleConnectionsCall(method, params = {}) {
  if (!CONNECTIONS_METHODS.has(method)) return { handled: false };

  try {
    switch (method) {
      case 'connections_providers': {
        const providers = await Promise.all(
          listProviders().map(async (spec) => ({
            id: spec.id,
            label: spec.label,
            description: spec.description,
            docs: spec.docs,
            auth_type: spec.auth.type,
            requires_client_secret: spec.auth.requires_client_secret,
            scopes: spec.auth.scopes,
            redirect_hint: `http://127.0.0.1:${spec.auth.callback_port}${spec.auth.callback_path}`,
            category: spec.category,
            ...(await session.getStatus(spec.id)),
          })),
        );
        return { handled: true, result: { providers, categories: listCategories() } };
      }

      case 'connections_oauth_config_save': {
        const provider = String(params.provider || '');
        const result = session.saveOAuthConfig(
          provider,
          params.client_id || '',
          params.client_secret || '',
        );
        emit('connections.changed', { provider });
        return { handled: true, result };
      }

      case 'connections_connect': {
        const { shell } = require('electron');
        const provider = String(params.provider || '');
        const result = await session.beginConnect(
          provider,
          (status) => emit('connections.changed', { provider, connected: true, status }),
          (err) =>
            emit('connections.changed', {
              provider,
              error: _sanitizeError(err).message,
            }),
        );
        await shell.openExternal(result.url);
        return { handled: true, result: { ...result, opened: true } };
      }

      case 'connections_disconnect': {
        const provider = String(params.provider || '');
        const result = await session.disconnect(provider);
        emit('connections.changed', { provider, connected: false });
        return { handled: true, result };
      }

      case 'connections_status': {
        const provider = String(params.provider || '');
        return { handled: true, result: await session.getStatus(provider) };
      }

      default:
        return { handled: false };
    }
  } catch (err) {
    throw _sanitizeError(err);
  }
}

module.exports = { handleConnectionsCall };
