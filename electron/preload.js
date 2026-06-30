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
      if (typeof method !== 'string' || !ALLOWED_RENDERER_METHODS.has(method)) {
        return Promise.reject(new Error(`IPC method not allowed: ${method}`));
      }
      return ipcRenderer.invoke('ipc-call', method, params);
    },
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
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },
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
  if (isDev) {
    console.error('Renderer error:', e.error);
  }
});
