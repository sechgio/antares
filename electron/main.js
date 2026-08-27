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

app.on('before-quit', async () => {
  try { const { cleanupAllStaged } = require('./file-capabilities'); await cleanupAllStaged(); } catch (e) { console.warn('[main] cleanupAllStaged failed:', e?.message); }
  _shutdownOnce();
});
app.on('will-quit', _shutdownOnce);
process.on('exit', _shutdownOnce);
process.on('SIGINT', () => { _shutdownOnce(); process.exit(0); });
process.on('SIGTERM', () => { _shutdownOnce(); process.exit(0); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(isDev);
});
