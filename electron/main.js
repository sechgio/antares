const { app, BrowserWindow, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createWindow, getMainWindow } = require('./window-manager');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');

const isDev = !app.isPackaged;

function _stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function _sanitizeUpdateInfo(info) {
  if (!info || typeof info !== 'object') return {};
  const version = String(info.version || '');
  const releaseDate = String(info.releaseDate || '');
  let releaseNotes = '';
  if (typeof info.releaseNotes === 'string') {
    releaseNotes = _stripHtml(info.releaseNotes);
  } else if (Array.isArray(info.releaseNotes)) {
    releaseNotes = info.releaseNotes
      .map((n) => (typeof n === 'object' ? _stripHtml(n.note || '') : _stripHtml(String(n))))
      .filter(Boolean)
      .join('\n');
  }
  return { version, releaseDate, releaseNotes };
}

autoUpdater.on('update-available', (info) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update-available', _sanitizeUpdateInfo(info));
});
autoUpdater.on('update-downloaded', (info) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update-downloaded', _sanitizeUpdateInfo(info));
});
autoUpdater.on('error', (err) => console.error('Auto-updater error:', err));

// Register IPC handlers before app is ready
registerIpcHandlers();

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    createWindow(isDev);
    await startPythonBackend(isDev);
    if (!isDev) autoUpdater.checkForUpdates();
  } catch (err) {
    dialog.showErrorBox('Error de inicio', err.message);
    app.quit();
  }
});

app.on('before-quit', killPython);
process.on('exit', killPython);

app.on('window-all-closed', () => {
  killPython();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(isDev);
});
