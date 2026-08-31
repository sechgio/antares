const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { createWindow } = require('./window-manager');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');
const { registerRendererObservability } = require('./renderer-observability');
const {
  appendLogEvent,
  appendLogLine,
  cleanStaleTempDirs,
  initAppLogs,
  installConsoleLogTee,
  setAppContext,
} = require('./app-log');

// Persistencia de logs del proceso principal en <dataDir>/logs (antes: solo consola).
// El tee se instala antes de cualquier handler para que warnings/errores y la
// telemetría IPC (ipc-router) queden grabados desde el primer momento.
installConsoleLogTee();

// Prevent unhandled rejections from crashing the process
// (e.g. auto-updater 404, dialog errors, etc.)
process.on('unhandledRejection', (reason) => {
  console.warn('[main] Unhandled rejection caught:', reason instanceof Error ? reason.message : reason);
});

const isDev = !app.isPackaged;
const { isTrustedRendererFrame } = require('./renderer-trust');

registerRendererObservability(ipcMain);
registerIpcHandlers();

app.whenReady().then(async () => {
  try {
    setAppContext({ appVersion: app.getVersion() });
    const logsDir = initAppLogs();
    const removedTemp = cleanStaleTempDirs();
    appendLogLine('INFO', `[main] app started (logs_dir=${logsDir}, stale_temp_dirs_removed=${removedTemp})`);
    appendLogEvent('INFO', 'app.started', { component: 'electron' });
  } catch (err) {
    console.warn('[main] log/temp init failed:', err && err.message);
  }
  Menu.setApplicationMenu(null);
  createWindow(isDev);
  _installWindowCloseGuard();
  startPythonBackend(isDev).catch((err) => {
    console.error('[main] startPythonBackend threw:', err);
  });
  // Deferred orphan canvas-asset GC (after docs settle; grace protects unsaved).
  setTimeout(() => {
    try {
      const { gcOrphanCanvasAssets } = require('./canvas-assets');
      gcOrphanCanvasAssets()
        .then((r) => {
          if (r.removed > 0) {
            appendLogLine('INFO', `[main] canvas asset GC removed=${r.removed} kept_refs=${r.kept}`);
          }
        })
        .catch((err) => {
          console.warn('[main] canvas asset GC failed:', err && err.message);
        });
    } catch (err) {
      console.warn('[main] canvas asset GC unavailable:', err && err.message);
    }
  }, 45_000);
  // Kick off auto-update check (no-op in dev / unpackaged builds).
  try {
    const { setupAutoUpdater } = require('./auto-updater');
    setupAutoUpdater(isDev);
  } catch (err) {
    console.warn('[main] setupAutoUpdater threw:', err && err.message);
  }
});

// Deduplicate shutdown: ensure killPython is invoked at most once per app lifecycle.
// Multiple shutdown events (`before-quit`, `will-quit`, `process.exit`,
// `window-all-closed` on non-macOS) can otherwise trigger redundant kills,
// which is benign (`_forceKillProcess` is idempotent) but produces noisy
// `taskkill` calls and potential races with auto-restart.
let _shutdownStarted = false;
let _isQuittingDeferred = false;
let _allowQuit = false;
let _canvasFlushResolver = null;
function _shutdownOnce() {
  if (_shutdownStarted) return;
  _shutdownStarted = true;
  appendLogLine('INFO', '[main] app quit');
  appendLogEvent('INFO', 'app.shutdown', { component: 'electron' });
  try {
    const { cleanupAutoSync } = require('./autoimg-sync-engine');
    cleanupAutoSync();
  } catch (err) {
    console.warn('[main] cleanupAutoSync threw during shutdown:', err && err.message);
  }
  try {
    const { cleanupAutoUpdater } = require('./auto-updater');
    cleanupAutoUpdater();
  } catch (err) {
    console.warn('[main] cleanupAutoUpdater threw during shutdown:', err && err.message);
  }
  try {
    killPython();
  } catch (err) {
    console.warn('[main] killPython threw during shutdown:', err && err.message);
  }
}

// Closing the window directly (titlebar X, Alt+F4, window-control close) can
// destroy the renderer before `before-quit` gets a chance to flush Canvas.
// Keep the guard reusable when macOS recreates the window after activation.
function _installWindowCloseGuard() {
  const { getMainWindow } = require('./window-manager');
  const win = getMainWindow();
  if (win && typeof win.on === 'function' && !win.isDestroyed()) {
    win.on('close', (event) => {
      if (_allowQuit || _shutdownStarted) return;
      event.preventDefault();
      if (_isQuittingDeferred) return;
      _isQuittingDeferred = true;
      void _flushCanvasAndQuit(win);
    });
  }
}

// Handler for the renderer flush acknowledgement; resolves before-quit.
ipcMain.handle('canvas-flush-ack', async (event) => {
  let trustedSender = false;
  try {
    const { getMainWindow } = require('./window-manager');
    const win = getMainWindow();
    const senderWin = win && !win.isDestroyed() ? win : null;
    trustedSender = isTrustedRendererFrame(event, senderWin, isDev);
    if (!trustedSender) {
      appendLogEvent('WARN', 'app.flush-ack-rejected', { component: 'electron', reason: 'untrusted_sender' });
    }
  } catch {}
  if (!trustedSender) return { ok: false };
  if (_canvasFlushResolver) {
    const resolve = _canvasFlushResolver;
    _canvasFlushResolver = null;
    resolve(true);
  }
  return { ok: true };
});

// Private channel used by the preload to register paths derived from File
// objects (native file inputs / drag-drop). The renderer cannot invoke this
// through the generic ipc-call surface; the sender frame is authenticated.
if (typeof ipcMain.on === 'function') {
  ipcMain.on('register-file-input-path', (event, rawPath) => {
    try {
      const { getMainWindow } = require('./window-manager');
      const win = getMainWindow();
      if (!isTrustedRendererFrame(event, win, isDev)) return;
      const { registerFileInputPath } = require('./dialog-handlers');
      registerFileInputPath(rawPath);
    } catch {
      // Best effort: callers fall back to staging/base64 if unavailable.
    }
  });
}

/** Grace period for the renderer to persist dirty Canvas docs. */
const CANVAS_FLUSH_TIMEOUT_MS = 120000;

async function _cleanupStagedFiles() {
  try {
    const { cleanupAllStaged } = require('./file-capabilities');
    await cleanupAllStaged();
  } catch (err) {
    console.warn('[main] cleanupAllStaged failed:', err?.message);
  }
}

async function _flushCanvasBeforeQuit(win) {
  if (!win || win.isDestroyed()) return false;
  const flushPromise = new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      _canvasFlushResolver = null;
      appendLogEvent('WARN', 'app.flush-timeout', { component: 'electron', timeout_ms: CANVAS_FLUSH_TIMEOUT_MS });
      resolve(false);
    }, CANVAS_FLUSH_TIMEOUT_MS);
    _canvasFlushResolver = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(!!ok);
    };
    try {
      win.webContents.send('ipc-notify', 'app.flush-canvas-before-quit', {});
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        _canvasFlushResolver = null;
        resolve(false);
      }
    }
  });
  const result = await flushPromise;
  _canvasFlushResolver = null;
  if (result) appendLogEvent('INFO', 'app.flush-acked', { component: 'electron' });
  return result;
}

/** Flush Canvas, clean staged files, stop Python, then complete the quit. */
async function _flushCanvasAndQuit(win) {
  try {
    if (win && !win.isDestroyed()) await _flushCanvasBeforeQuit(win);
  } catch (err) {
    console.warn('[main] canvas flush before quit failed:', err && err.message);
  }
  await _cleanupStagedFiles();
  _shutdownOnce();
  _allowQuit = true;
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch { /* already destroyed */ }
  }
  app.quit();
}

app.on('before-quit', (event) => {
  if (_allowQuit) return;
  if (_isQuittingDeferred) {
    event.preventDefault();
    return;
  }
  const { getMainWindow } = require('./window-manager');
  const win = getMainWindow();
  if (win && !win.isDestroyed() && !_shutdownStarted) {
    event.preventDefault();
    _isQuittingDeferred = true;
    return _flushCanvasAndQuit(win);
  }
  _allowQuit = true;
  void (async () => {
    await _cleanupStagedFiles();
    _shutdownOnce();
  })();
});
app.on('will-quit', _shutdownOnce);
process.on('exit', _shutdownOnce);
process.on('SIGINT', () => { _shutdownOnce(); process.exit(0); });
process.on('SIGTERM', () => { _shutdownOnce(); process.exit(0); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(isDev);
    _installWindowCloseGuard();
  }
});
