const { app, Menu, ipcMain, Tray, Notification } = require('electron');
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
const ownsRuntime = app.requestSingleInstanceLock();
if (!ownsRuntime) app.quit();
let _tray = null;
const _trayStates = new Map();
let _trayPolling = false;

async function _notifyAgentActivity() {
  if (!_tray || _trayPolling || _shutdownStarted) return;
  _trayPolling = true;
  try {
    const win = require('./window-manager').getMainWindow();
    const states = await require('./agent-runtime').activitySnapshot();
    for (const item of states) {
      const previous = _trayStates.get(item.id);
      _trayStates.set(item.id, item.status);
      if (previous === item.status || win?.isVisible() || !Notification.isSupported()) continue;
      const needsInput = item.status === 'waiting_input' || item.status === 'waiting_approval';
      const ended = ['running', 'waiting_input', 'waiting_approval', 'waiting_event'].includes(previous)
        && ['completed', 'failed', 'uncertain'].includes(item.status);
      const needsReview = item.status === 'uncertain';
      if (!needsInput && !ended && !needsReview) continue;
      const body = item.status === 'waiting_approval' ? 'Necesita tu aprobación' : item.status === 'waiting_input' ? 'Necesita datos para continuar'
        : item.status === 'failed' || needsReview ? 'El encargo requiere revisión' : 'El encargo terminó';
      const notification = new Notification({ title: item.title, body });
      notification.on('click', _showMainWindow);
      notification.show();
    }
  } catch (err) { console.warn('[main] agent tray status failed:', err?.message); }
  finally { _trayPolling = false; }
}

function _showMainWindow() {
  let win = require('./window-manager').getMainWindow();
  if (!win || win.isDestroyed()) {
    createWindow(isDev);
    _installWindowCloseGuard();
    win = require('./window-manager').getMainWindow();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.on('second-instance', _showMainWindow);
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
  if (!ownsRuntime) return;
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
  // El backend es la ruta crítica del arranque: se lanza antes de crear la ventana.
  startPythonBackend(isDev).then(() => require('./agent-runtime').open()).catch((err) => {
    console.error('[main] startPythonBackend threw:', err);
  });
  createWindow(isDev);
  _installWindowCloseGuard();
  _tray = new Tray(require('node:path').join(__dirname, '..', 'assets', 'icon.ico'));
  _tray.setToolTip('Antares');
  _tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar Antares', click: _showMainWindow },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  _tray.on('double-click', _showMainWindow);
  const agentTrayTimer = setInterval(_notifyAgentActivity, 2000);
  agentTrayTimer.unref?.();
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
  if (!ownsRuntime) return;
  if (_tray) { _tray.destroy(); _tray = null; }
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
    require('./agent-runtime').shutdown().catch(() => {});
  } catch (err) {
    console.warn('[main] agent runtime shutdown threw:', err && err.message);
  }
  try {
    killPython();
  } catch (err) {
    console.warn('[main] killPython threw during shutdown:', err && err.message);
  }
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
      if (_tray && !_isQuittingDeferred) {
        win.hide();
        return;
      }
      if (_isQuittingDeferred) return;
      _isQuittingDeferred = true;
      void _flushCanvasAndQuit(win);
    });
  }
}

ipcMain.handle('canvas-flush-ack', async (event, saved) => {
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
    resolve(saved === false ? 'save_failed' : true);
  }
  return { ok: true };
});

if (typeof ipcMain.on === 'function') {
  ipcMain.on('register-file-input-path', (event, payload) => {
    try {
      const { getMainWindow, getFileInputNonce } = require('./window-manager');
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
      const nonce = typeof getFileInputNonce === 'function' ? getFileInputNonce() : null;
      const rawPath = payload && typeof payload === 'object' ? payload.path : null;
      if (!nonce || !rawPath || payload.nonce !== nonce) {
        appendLogEvent('WARN', 'security.rejected', {
          component: 'electron',
          outcome: 'rejected',
          reason: 'invalid_file_input_nonce',
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
    const webContents = win.webContents;
    function settle(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _canvasFlushResolver = null;
      try {
        webContents.removeListener('render-process-gone', onRendererGone);
        webContents.removeListener('destroyed', onRendererGone);
      } catch {}
      resolve(ok);
    }
    const onRendererGone = () => {
      appendLogEvent('WARN', 'app.flush-aborted', { component: 'electron', reason: 'renderer_gone' });
      settle(false);
    };
    const timer = setTimeout(() => {
      appendLogEvent('WARN', 'app.flush-timeout', { component: 'electron', timeout_ms: CANVAS_FLUSH_TIMEOUT_MS });
      settle(false);
    }, CANVAS_FLUSH_TIMEOUT_MS);
    _canvasFlushResolver = (result) => settle(result);
    if (webContents && typeof webContents.once === 'function') {
      webContents.once('render-process-gone', onRendererGone);
      webContents.once('destroyed', onRendererGone);
    }
    try {
      webContents.send('ipc-notify', 'app.flush-canvas-before-quit', {});
    } catch {
      settle(false);
    }
  });
  const result = await flushPromise;
  _canvasFlushResolver = null;
  if (result === true) appendLogEvent('INFO', 'app.flush-acked', { component: 'electron' });
  return result;
}

async function _flushCanvasAndQuit(win) {
  try {
    if (win && !win.isDestroyed() && await _flushCanvasBeforeQuit(win) === 'save_failed') {
      _isQuittingDeferred = false;
      appendLogEvent('WARN', 'app.flush-aborted', { component: 'electron', reason: 'editor_save_failed' });
      return;
    }
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
  if (!ownsRuntime) { _allowQuit = true; return; }
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
  if (!_tray && process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (ownsRuntime) _showMainWindow();
});
