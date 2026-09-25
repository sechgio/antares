const { app, ipcMain } = require('electron');
const { getMainWindow } = require('./window-manager');
const { appendLogEvent, logInfo } = require('./app-log');

let _autoUpdater = null;
let _updateInProgress = false;
let _updateInProgressTimer = null;
let _updateDownloaded = false;
let _availableVersion = null;
let _manualCheckRequested = false;
let _periodicCheckTimer = null;
let _lastLoggedPercent = -1;

const UPDATE_IN_PROGRESS_TIMEOUT_MS = 30 * 60 * 1000;

function _clearUpdateInProgress() {
  _updateInProgress = false;
  if (_updateInProgressTimer) {
    clearTimeout(_updateInProgressTimer);
    _updateInProgressTimer = null;
  }
}

function _armUpdateInProgress() {
  _updateInProgress = true;
  if (_updateInProgressTimer) clearTimeout(_updateInProgressTimer);
  _updateInProgressTimer = setTimeout(() => {
    console.warn('[auto-updater] _updateInProgress timed out; clearing stuck flag');
    _updateInProgress = false;
    _updateInProgressTimer = null;
  }, UPDATE_IN_PROGRESS_TIMEOUT_MS);
}

function _loadAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  try {
    _autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('[auto-updater] electron-updater no disponible:', err.message);
    return null;
  }

  _autoUpdater.autoDownload = true;
  _autoUpdater.autoInstallOnAppQuit = false;

  _autoUpdater.logger = {
    info: (...a) => logInfo('[auto-updater]', ...a),
    warn: (...a) => console.warn('[auto-updater]', ...a),
    error: (...a) => console.error('[auto-updater]', ...a),
    debug: () => {},
  };

  return _autoUpdater;
}

function _broadcastToRenderer(channel, data) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function setupAutoUpdater(isDev) {
  if (process.env.ANTARES_PERF_BENCHMARK === '1') {
    logInfo('[auto-updater] desactivado (benchmark local).');
    return;
  }

  if (isDev || !app.isPackaged) {
    logInfo('[auto-updater] desactivado (modo dev / app no empaquetada). Registrando manejadores mock.');

    ipcMain.handle('auto-update-check', async (event) => {
      const { _isAllowedIpcSender } = require('./ipc-router');
      if (!_isAllowedIpcSender(event)) {
        appendLogEvent('WARN', 'security.rejected', {
          component: 'electron',
          outcome: 'rejected',
          reason: 'untrusted_sender',
          method: 'auto-update-check',
        });
        return { success: false, reason: 'untrusted sender' };
      }
      logInfo('[auto-updater] (dev) Manual check requested. Mocking up-to-date.');
      setTimeout(() => {
        _broadcastToRenderer('auto-update-status', {
          status: 'up-to-date',
          version: app.getVersion(),
          progress: 0,
        });
      }, 500);
      return { success: true };
    });

    ipcMain.handle('auto-update-install', async (event) => {
      const { _isAllowedIpcSender } = require('./ipc-router');
      if (!_isAllowedIpcSender(event)) {
        appendLogEvent('WARN', 'security.rejected', {
          component: 'electron',
          outcome: 'rejected',
          reason: 'untrusted_sender',
          method: 'auto-update-install',
        });
        return { success: false, reason: 'untrusted sender' };
      }
      return { success: false, reason: 'No disponible en modo desarrollo' };
    });

    return;
  }

  const updater = _loadAutoUpdater();
  if (!updater) return;

  updater.on('checking-for-update', () => {
    logInfo('[auto-updater] buscando actualizaciones...');
    appendLogEvent('INFO', 'updater.check_start', {
      reason: _manualCheckRequested ? 'manual' : 'periodic',
    });
  });

  updater.on('update-available', (info) => {
    _armUpdateInProgress();
    _updateDownloaded = false;
    _lastLoggedPercent = -1;
    _availableVersion = info?.version || 'unknown';
    logInfo('[auto-updater] versión disponible:', info?.version);
    appendLogEvent('INFO', 'updater.available', { message: `version=${_availableVersion}` });
    _broadcastToRenderer('auto-update-status', {
      status: 'available',
      version: _availableVersion,
      progress: 0,
    });
  });

  updater.on('update-not-available', () => {
    logInfo('[auto-updater] no hay actualizaciones.');
    appendLogEvent('INFO', 'updater.check', { outcome: 'success', reason: 'up_to_date' });
    if (_manualCheckRequested) {
      _manualCheckRequested = false;
      _broadcastToRenderer('auto-update-status', {
        status: 'up-to-date',
        version: app.getVersion(),
        progress: 0,
      });
    }
  });

  updater.on('download-progress', (p) => {
    if (p && Number.isFinite(p.percent)) {
      const rounded = Math.round(p.percent);
      if (rounded !== _lastLoggedPercent) {
        _lastLoggedPercent = rounded;
        logInfo(`[auto-updater] descargando ${p.percent.toFixed(1)}%`);
      }
      _broadcastToRenderer('auto-update-status', {
        status: 'downloading',
        version: _availableVersion,
        progress: Math.round(p.percent),
      });
    }
  });

  updater.on('update-downloaded', (info) => {
    _clearUpdateInProgress();
    _updateDownloaded = true;
    _availableVersion = info?.version || _availableVersion;
    logInfo('[auto-updater] descarga lista.');
    appendLogEvent('INFO', 'updater.downloaded', {
      outcome: 'success',
      message: `version=${_availableVersion}`,
    });
    _broadcastToRenderer('auto-update-status', {
      status: 'ready',
      version: _availableVersion,
      progress: 100,
    });
  });

  updater.on('error', (err) => {
    _clearUpdateInProgress();
    console.warn('[auto-updater] error:', err && err.message ? err.message : err);
    appendLogEvent('ERROR', 'updater.error', {
      outcome: 'failed',
      error_code: err && err.name ? err.name : 'updater_error',
      message: err && err.message ? err.message : String(err),
    });
    _broadcastToRenderer('auto-update-status', {
      status: 'error',
      version: null,
      progress: 0,
      message: err && err.message ? err.message : String(err),
    });
  });

  setTimeout(() => {
    updater.checkForUpdates().catch((err) => {
      console.warn('[auto-updater] checkForUpdates falló:', err.message);
      appendLogEvent('WARN', 'updater.error', {
        outcome: 'failed',
        reason: 'check_failed',
        message: err && err.message ? err.message : String(err),
      });
    });
  }, 8_000);

  _periodicCheckTimer = setInterval(() => {
    if (_updateInProgress) return;
    updater.checkForUpdates().catch((err) => {
      console.warn('[auto-updater] periodic checkForUpdates falló:', err && err.message ? err.message : err);
      appendLogEvent('WARN', 'updater.error', {
        outcome: 'failed',
        reason: 'check_failed',
        message: err && err.message ? err.message : String(err),
      });
    });
  }, 6 * 60 * 60 * 1000);

  ipcMain.handle('auto-update-check', async (event) => {
    const { _isAllowedIpcSender } = require('./ipc-router');
    if (!_isAllowedIpcSender(event)) {
      appendLogEvent('WARN', 'security.rejected', {
        component: 'electron',
        outcome: 'rejected',
        reason: 'untrusted_sender',
        method: 'auto-update-check',
      });
      return { success: false, reason: 'untrusted sender' };
    }
    logInfo('[auto-updater] Manual check requested. In progress:', _updateInProgress);
    if (!updater || _updateInProgress) {
      const reason = !updater ? 'updater not loaded' : 'update in progress';
      logInfo('[auto-updater] Check rejected:', reason);
      return { success: false, reason };
    }
    _manualCheckRequested = true;
    logInfo('[auto-updater] Calling checkForUpdates...');
    try {
      const result = await updater.checkForUpdates();
      logInfo('[auto-updater] checkForUpdates result:', result?.version || 'no update');
      return { success: true };
    } catch (err) {
      console.warn('[auto-updater] checkForUpdates error:', err.message);
      return { success: false, reason: err.message };
    }
  });

  ipcMain.handle('auto-update-install', async (event) => {
    const { _isAllowedIpcSender } = require('./ipc-router');
    if (!_isAllowedIpcSender(event)) {
      appendLogEvent('WARN', 'security.rejected', {
        component: 'electron',
        outcome: 'rejected',
        reason: 'untrusted_sender',
        method: 'auto-update-install',
      });
      return { success: false, reason: 'untrusted sender' };
    }
    if (!_updateDownloaded || !_autoUpdater) {
      appendLogEvent('WARN', 'updater.install', { outcome: 'rejected', reason: 'update_not_ready' });
      return { success: false, reason: 'update not ready' };
    }
    appendLogEvent('INFO', 'updater.install', { outcome: 'success' });
    _autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });
}

function cleanupAutoUpdater() {
  if (_periodicCheckTimer) {
    clearInterval(_periodicCheckTimer);
    _periodicCheckTimer = null;
  }
  if (_updateInProgressTimer) {
    clearTimeout(_updateInProgressTimer);
    _updateInProgressTimer = null;
  }
}

module.exports = { setupAutoUpdater, cleanupAutoUpdater };
