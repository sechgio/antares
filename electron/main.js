const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { createWindow } = require('./window-manager');
const { raceTimeout } = require('./async-utils');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');
const { registerRendererObservability } = require('./renderer-observability');
const {
  appendLogEvent,
  appendLogLine,
  cleanStaleTempDirs,
  flushLogQueue,
  flushLogQueueSync,
  initAppLogs,
  installConsoleLogTee,
  setAppContext,
} = require('./app-log');

installConsoleLogTee();

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  console.warn('[main] Unhandled rejection caught:', message);
  try {
    appendLogEvent('ERROR', 'app.unhandled_rejection', {
      component: 'electron',
      outcome: 'failed',
      reason: reason instanceof Error && reason.name ? reason.name : 'unhandled_rejection',
      message,
    });
  } catch {}
});

process.on('uncaughtException', async (err) => {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error('[main] Uncaught exception:', message);
  try {
    appendLogEvent('ERROR', 'app.uncaught_exception', {
      component: 'electron',
      outcome: 'failed',
      reason: err instanceof Error && err.name ? err.name : 'uncaught_exception',
      message,
    });
  } catch {}
  await raceTimeout(flushLogQueue(), 1_000, () => {});
  try {
    flushLogQueueSync();
  } catch {}
  process.exit(1);
});

// Los 'Tab' ya los cubre render-process-gone del webContents de la ventana.
app.on('child-process-gone', (_event, details) => {
  try {
    if (details && details.type === 'Tab') return;
    appendLogEvent('ERROR', 'renderer.lifecycle', {
      component: 'electron',
      outcome: 'failed',
      reason: 'child_process_gone',
      message: `type=${details && details.type ? details.type : 'unknown'} reason=${details && details.reason ? details.reason : 'unknown'} exit_code=${details && Number.isInteger(details.exitCode) ? details.exitCode : 'unknown'}`,
    });
  } catch {}
});

const isDev = !app.isPackaged;
const { isTrustedRendererFrame } = require('./renderer-trust');
const CANVAS_ASSET_GC_INITIAL_DELAY_MS = 45_000;
const CANVAS_ASSET_GC_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runCanvasAssetGc() {
  try {
    const { gcOrphanCanvasAssets } = require('./canvas-assets');
    return gcOrphanCanvasAssets()
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
    return Promise.resolve();
  }
}

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
  const canvasAssetGcInitialTimer = setTimeout(runCanvasAssetGc, CANVAS_ASSET_GC_INITIAL_DELAY_MS);
  canvasAssetGcInitialTimer.unref?.();
  const canvasAssetGcTimer = setInterval(runCanvasAssetGc, CANVAS_ASSET_GC_INTERVAL_MS);
  canvasAssetGcTimer.unref?.();
  try {
    const { setupAutoUpdater } = require('./auto-updater');
    setupAutoUpdater(isDev);
  } catch (err) {
    console.warn('[main] setupAutoUpdater threw:', err && err.message);
  }
});

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
  // Las rutas will-quit/exit/SIGINT no pueden awaitear la cola asincrona; sin este
  // respaldo sincrono se perderian los logs encolados aqui (regresion vs appendFileSync).
  try {
    flushLogQueueSync();
  } catch {}
}

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

if (typeof ipcMain.on === 'function') {
  ipcMain.on('register-file-input-path', (event, rawPath) => {
    try {
      const { getMainWindow } = require('./window-manager');
      const win = getMainWindow();
      if (!isTrustedRendererFrame(event, win, isDev)) {
        appendLogEvent('WARN', 'security.rejected', {
          component: 'electron',
          outcome: 'rejected',
          reason: 'untrusted_sender',
          method: 'register-file-input-path',
        });
        return;
      }
      const { registerFileInputPath } = require('./dialog-handlers');
      registerFileInputPath(rawPath);
    } catch (err) {
      console.warn('[main] register-file-input-path failed:', err && err.message);
    }
  });
}

// Debe superar el tier "long" del catálogo IPC (canvas_save/canvas_save_history,
// 300 s): si el flush vence antes que el save en vuelo, el quit mata al backend
// a mitad de escritura y se pierde la última edición.
const CANVAS_FLUSH_TIMEOUT_MS = 310000;

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

async function _flushCanvasAndQuit(win) {
  try {
    if (win && !win.isDestroyed()) await _flushCanvasBeforeQuit(win);
  } catch (err) {
    console.warn('[main] canvas flush before quit failed:', err && err.message);
  }
  await _cleanupStagedFiles();
  _shutdownOnce();
  await raceTimeout(flushLogQueue(), 5_000, () => {});
  _allowQuit = true;
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch {}
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
