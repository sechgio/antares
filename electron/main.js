const { app, BrowserWindow, Menu } = require('electron');
const { createWindow } = require('./window-manager');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');
const { setupAutoUpdater } = require('./auto-updater');

// Prevent unhandled rejections from crashing the process
// (e.g. auto-updater 404, dialog errors, etc.)
process.on('unhandledRejection', (reason) => {
  console.warn('[main] Unhandled rejection caught:', reason instanceof Error ? reason.message : reason);
});

const isDev = !app.isPackaged;

// Register IPC handlers before app is ready
registerIpcHandlers();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  createWindow(isDev);
  startPythonBackend(isDev).catch((err) => {
    console.error('[main] startPythonBackend threw:', err);
  });
  // Kick off auto-update check (no-op in dev / unpackaged builds).
  try {
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
  try {
    killPython();
  } catch (err) {
    console.warn('[main] killPython threw during shutdown:', err && err.message);
  }
}

app.on('before-quit', _shutdownOnce);
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
