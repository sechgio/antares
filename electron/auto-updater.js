/**
 * Auto-update wiring around `electron-updater`.
 *
 * Strategy: GitHub Releases (free for public repos). The updater downloads
 * the new installer in the background and prompts the user — OpenCode style —
 * with "Instalar y reiniciar / Todavía no" once the download finishes.
 *
 * Requirements:
 *   - electron-builder publishes installers + `latest.yml` to GitHub Releases.
 *   - `publish` block in electron-builder.yml is configured to GitHub.
 *   - Only runs when the app is packaged (skips dev mode).
 */
const { app, dialog, ipcMain } = require('electron');
const { getMainWindow } = require('./window-manager');

let _autoUpdater = null;
let _updateInProgress = false;
let _updateDownloaded = false;
let _downloadProgress = 0;
let _availableVersion = null;
let _manualCheckRequested = false;

function _loadAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  try {
    _autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('[auto-updater] electron-updater no disponible:', err.message);
    return null;
  }

  _autoUpdater.autoDownload = true;
  _autoUpdater.autoInstallOnAppQuit = true;

  _autoUpdater.logger = {
    info: (...a) => console.log('[auto-updater]', ...a),
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

async function _promptInstall(info) {
  const win = getMainWindow();
  const version = info?.version ? ` (${info.version})` : '';
  const opts = {
    type: 'info',
    buttons: ['Instalar y reiniciar', 'Todavía no'],
    defaultId: 0,
    cancelId: 1,
    title: 'Actualización disponible',
    message: `Una nueva versión de ANTARES${version} está lista para instalar.`,
    detail: 'La aplicación se cerrará y se reabrirá automáticamente.',
    noLink: true,
  };

  try {
    const result = win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts);

    if (result.response === 0 && _autoUpdater) {
      setImmediate(() => _autoUpdater.quitAndInstall(false, true));
    }
  } catch (err) {
    console.warn('[auto-updater] prompt error:', err.message);
  }
}

function setupAutoUpdater(isDev) {
  if (isDev || !app.isPackaged) {
    console.log('[auto-updater] desactivado (modo dev / app no empaquetada).');
    return;
  }

  const updater = _loadAutoUpdater();
  if (!updater) return;

  updater.on('checking-for-update', () => {
    console.log('[auto-updater] buscando actualizaciones...');
  });

  updater.on('update-available', (info) => {
    _updateInProgress = true;
    _updateDownloaded = false;
    _downloadProgress = 0;
    _availableVersion = info?.version || 'unknown';
    console.log('[auto-updater] versión disponible:', info?.version);
    _broadcastToRenderer('auto-update-status', {
      status: 'available',
      version: _availableVersion,
      progress: 0,
    });
  });

  updater.on('update-not-available', () => {
    console.log('[auto-updater] no hay actualizaciones.');
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
      _downloadProgress = p.percent;
      console.log(`[auto-updater] descargando ${p.percent.toFixed(1)}%`);
      _broadcastToRenderer('auto-update-status', {
        status: 'downloading',
        version: _availableVersion,
        progress: Math.round(p.percent),
      });
    }
  });

  updater.on('update-downloaded', (info) => {
    _updateInProgress = false;
    _updateDownloaded = true;
    _downloadProgress = 100;
    _availableVersion = info?.version || _availableVersion;
    console.log('[auto-updater] descarga lista.');
    _broadcastToRenderer('auto-update-status', {
      status: 'ready',
      version: _availableVersion,
      progress: 100,
    });
    _promptInstall(info);
  });

  updater.on('error', (err) => {
    _updateInProgress = false;
    _downloadProgress = 0;
    console.warn('[auto-updater] error:', err && err.message ? err.message : err);
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
    });
  }, 8_000);

  setInterval(() => {
    if (_updateInProgress) return;
    updater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);

  ipcMain.handle('auto-update-check', async () => {
    console.log('[auto-updater] Manual check requested. In progress:', _updateInProgress);
    if (!updater || _updateInProgress) {
      const reason = !updater ? 'updater not loaded' : 'update in progress';
      console.log('[auto-updater] Check rejected:', reason);
      return { success: false, reason };
    }
    _manualCheckRequested = true;
    console.log('[auto-updater] Calling checkForUpdates...');
    try {
      const result = await updater.checkForUpdates();
      console.log('[auto-updater] checkForUpdates result:', result?.version || 'no update');
      return { success: true };
    } catch (err) {
      console.warn('[auto-updater] checkForUpdates error:', err.message);
      return { success: false, reason: err.message };
    }
  });

  ipcMain.handle('auto-update-install', async () => {
    if (!_updateDownloaded || !_autoUpdater) {
      return { success: false, reason: 'update not ready' };
    }
    _autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });
}

module.exports = { setupAutoUpdater };
