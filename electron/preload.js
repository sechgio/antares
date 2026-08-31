const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Resolve the IPC allowlist. Under sandbox: true the preload cannot
// `require('./ipc-methods')`, so the main process injects the list via
// webPreferences.additionalArguments. We fall back to requiring the shared
// module for non-sandboxed contexts and Node-based integration tests.
function resolveAllowedMethods() {
  const prefix = '--allowed-ipc-methods=';
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (arg) {
    try {
      return new Set(JSON.parse(arg.slice(prefix.length)));
    } catch {
      /* fall through to the shared-module fallback */
    }
  }
  try {
    const { ALLOWED_RENDERER_METHODS } = require('./ipc-methods');
    return new Set(ALLOWED_RENDERER_METHODS);
  } catch {
    return new Set();
  }
}

const ALLOWED_RENDERER_METHODS = resolveAllowedMethods();

function reportRendererError(payload) {
  try {
    ipcRenderer.send('renderer-error', payload);
  } catch {
    // Error reporting is best-effort and must not affect the renderer.
  }
}

function registerFileInputPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  try {
    ipcRenderer.send('register-file-input-path', filePath);
    return true;
  } catch {
    return false;
  }
}

function reportRendererEvent(event, fields, level) {
  try {
    ipcRenderer.send('renderer-event', { event, fields, level });
  } catch {
    // Event reporting is best-effort and must not affect the renderer.
  }
}

// NODE_ENV no es confiable en apps empaquetadas (Electron no lo setea por
// defecto, así que los logs debug aparecían en producción). El marcador fiable
// es `app.isPackaged`, pero el preload corre con sandbox: true y no tiene
// acceso a `app` ni a `__dirname`, así que el main lo inyecta vía
// additionalArguments (mismo canal que la allowlist). En contextos no
// sandboxed (tests Node) sin la inyección, se cae al marcador asar.
function resolveIsPackaged() {
  const prefix = '--app-is-packaged=';
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (arg) return arg.slice(prefix.length) === '1';
  try {
    return typeof __dirname !== 'undefined' && /[\\/]app\.asar[\\/]/.test(__dirname);
  } catch {
    return false;
  }
}

const isDev = process.env?.NODE_ENV !== 'production' && !resolveIsPackaged();

if (isDev) {
  console.debug('[preload] Preload script executing...');
}

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (method, params = {}) => {
      // Always forward to the main process. The real security gate lives in
      // ipc-router (which re-reads ipc-methods.js in unpackaged/dev builds).
      // A stale preload allowlist (window created before new methods were added)
      // used to reject valid methods before main could allow them — that broke
      // tools like fichas_tecnicas_* after Vite HMR without a full Electron restart.
      if (typeof method !== 'string' || !method) {
        return Promise.reject(new Error('IPC method not allowed: invalid method name.'));
      }
      if (!isDev && ALLOWED_RENDERER_METHODS.size > 0 && !ALLOWED_RENDERER_METHODS.has(method)) {
        return Promise.reject(new Error(`IPC method not allowed: ${method}`));
      }
      // Soft warn for unknown methods in dev when we still have an injected list.
      if (ALLOWED_RENDERER_METHODS.size > 0 && !ALLOWED_RENDERER_METHODS.has(method) && isDev) {
        console.warn(
          `[preload] method "${method}" not in window-create allowlist; forwarding to main (may require Electron restart if main is also stale)`,
        );
      }
      return ipcRenderer.invoke('ipc-call', method, params);
    },
    reportRendererError,
    reportRendererEvent,
    backendStatus: () => ipcRenderer.invoke('backend-status'),
    backendRestart: () => ipcRenderer.invoke('backend-restart'),
    onNotify: (callback) => {
      const listener = (event, method, params) => callback(method, params);
      ipcRenderer.on('ipc-notify', listener);
      return () => ipcRenderer.removeListener('ipc-notify', listener);
    },
    minimizeWindow: () => ipcRenderer.invoke('window-control', 'minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-control', 'maximize'),
    closeWindow: () => ipcRenderer.invoke('window-control', 'close'),
    showAppMenu: (menuIndex, position) => ipcRenderer.invoke('app-menu-popup', menuIndex, position),
    autoUpdateCheck: () => ipcRenderer.invoke('auto-update-check'),
    autoUpdateInstall: () => ipcRenderer.invoke('auto-update-install'),
    onAutoUpdateStatus: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('auto-update-status', listener);
      return () => ipcRenderer.removeListener('auto-update-status', listener);
    },
    // Electron 32+ removed File.path; webUtils.getPathForFile is the
    // supported way to resolve a File from <input> or drop events to an
    // absolute filesystem path. Exposed here because the renderer runs with
    // contextIsolation and cannot import electron modules directly.
    getPathForFile: (file) => {
      try {
        const resolvedPath = webUtils.getPathForFile(file) || '';
        if (resolvedPath) {
          // File-derived paths (file inputs / drag-drop) are registered through
          // a private authenticated channel. Registration is best-effort and
          // never changes the caller's path-resolution behavior.
          registerFileInputPath(resolvedPath);
        }
        return resolvedPath;
      } catch {
        return '';
      }
    },
    registerFileInputPath,
    canvasFlushAck: () => ipcRenderer.invoke('canvas-flush-ack'),
    registerLocalPath: (filePath) => ipcRenderer.invoke('ipc-call', 'register_local_path', { path: filePath }),
    fileStagedCreate: (name, size) => ipcRenderer.invoke('ipc-call', 'file_staged_create', { name, size }),
    // Prefer ArrayBuffer/Uint8Array (no base64). Strings still sent as chunk_b64 for legacy.
    fileStagedAppend: (token, chunk) => {
      if (typeof chunk === 'string') {
        return ipcRenderer.invoke('ipc-call', 'file_staged_append', { token, chunk_b64: chunk });
      }
      return ipcRenderer.invoke('ipc-call', 'file_staged_append', { token, chunk });
    },
    fileStagedComplete: (token) => ipcRenderer.invoke('ipc-call', 'file_staged_complete', { token }),
    fileStagedAbort: (token) => ipcRenderer.invoke('ipc-call', 'file_staged_abort', { token }),
    ...(isDev ? { resolveFileToken: (token) => ipcRenderer.invoke('ipc-call', 'file_token_resolve', { token }) } : {}),
    cleanupFileToken: (token) => ipcRenderer.invoke('ipc-call', 'file_token_cleanup', { token }),
    canvasAssetPut: (chunk) => ipcRenderer.invoke('ipc-call', 'canvas_asset_put', { chunk }),
    canvasAssetGet: (ref) => ipcRenderer.invoke('ipc-call', 'canvas_asset_get', { ref }),
  });
  if (isDev) {
    console.debug('[preload] electronAPI exposed successfully');
  }
} catch (err) {
  if (isDev) {
    console.error('[preload] Failed to expose electronAPI:', err);
  }
}

window.addEventListener('error', (e) => {
  reportRendererError({
    kind: 'global_error',
    name: e.error?.name,
    message: e.message || e.error?.message,
    stack: e.error?.stack,
  });
  if (isDev) {
    console.error('Renderer error:', e.error);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportRendererError({
    kind: 'unhandled_rejection',
    name: reason?.name,
    message: reason?.message || String(reason || 'unhandled rejection'),
    stack: reason?.stack,
  });
});
