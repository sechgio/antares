const { app, BrowserWindow, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createWindow, getMainWindow } = require('./window-manager');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');

const isDev = !app.isPackaged;

// Auto-updater events
autoUpdater.on('update-available', (info) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update-available', info);
});
autoUpdater.on('update-downloaded', (info) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update-downloaded', info);
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
