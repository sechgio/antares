const { contextBridge, ipcRenderer, webUtils } = require('electron');

function resolveAllowedMethods() {
  const prefix = '--allowed-ipc-methods=';
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (arg) {
    try {
      return new Set(JSON.parse(arg.slice(prefix.length)));
    } catch {
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
  }
}

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
      if (typeof method !== 'string' || !method) {
        return Promise.reject(new Error('IPC method not allowed: invalid method name.'));
      }
      if (!isDev && ALLOWED_RENDERER_METHODS.size > 0 && !ALLOWED_RENDERER_METHODS.has(method)) {
        return Promise.reject(new Error(`IPC method not allowed: ${method}`));
      }
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
    getPathForFile: (file) => {
      try {
        const resolvedPath = webUtils.getPathForFile(file) || '';
        if (resolvedPath) {
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
