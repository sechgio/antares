const { app, BrowserWindow, Menu } = require('electron');
const { createWindow } = require('./window-manager');
const { startPythonBackend, killPython } = require('./backend-spawner');
const { registerIpcHandlers } = require('./ipc-router');

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
