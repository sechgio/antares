/**
 * IPC routing: request/response correlation, notifications forwarding.
 */
const { ipcMain, dialog } = require('electron');
const { handleDialogCall } = require('./dialog-handlers');
const { getProcess } = require('./backend-spawner');
const { getMainWindow, buildAppMenu } = require('./window-manager');

const _pendingRequests = new Map();
let _ipcListenersReady = false;

function setupIpcResponseListener() {
  const proc = getProcess();
  if (!proc) return;
  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.method && msg.params && msg.id === undefined) {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', msg.method, msg.params);
          continue;
        }
        if (msg.id !== undefined && _pendingRequests.has(String(msg.id))) {
          const entry = _pendingRequests.get(String(msg.id));
          clearTimeout(entry.timeout);
          _pendingRequests.delete(String(msg.id));
          if (msg.error) entry.reject(new Error(msg.error.message || msg.error));
          else entry.resolve(msg.result);
        }
      } catch { /* ignore */ }
    }
  });

  proc.on('close', () => {
    _ipcListenersReady = false;
    for (const [, entry] of _pendingRequests) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Backend process exited'));
    }
    _pendingRequests.clear();
  });
}

function ensureIpcListeners() {
  if (_ipcListenersReady) return;
  setupIpcResponseListener();
  _ipcListenersReady = true;
}

function registerIpcHandlers() {
  ipcMain.handle('ipc-call', async (event, method, params) => {
    const win = getMainWindow();
    const { BrowserWindow } = require('electron');
    const dialogResult = await handleDialogCall(method, params, dialog, win, { BrowserWindow });
    if (dialogResult.handled) return dialogResult.result;

    const proc = getProcess();
    if (!proc || proc.killed) throw new Error('Backend no disponible');

    ensureIpcListeners();
    const id = Math.random().toString(36).slice(2);
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        _pendingRequests.delete(id);
        const w = getMainWindow();
        if (w && !w.isDestroyed()) w.webContents.send('ipc-notify', 'ipc.error', { message: 'IPC timeout: backend no responde' });
        reject(new Error('IPC timeout'));
      }, 30000);
      _pendingRequests.set(id, { resolve, reject, timeout: timeoutId });
      try { proc.stdin.write(JSON.stringify(request) + '\n'); } catch (err) {
        clearTimeout(timeoutId);
        _pendingRequests.delete(id);
        reject(new Error('Backend stdin write failed: ' + err.message));
      }
    });
  });

  ipcMain.handle('window-control', async (_event, action) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { handled: false };
    if (action === 'minimize') { win.minimize(); return { handled: true }; }
    if (action === 'maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); return { handled: true, maximized: win.isMaximized() }; }
    if (action === 'close') { win.close(); return { handled: true }; }
    return { handled: false };
  });

  ipcMain.handle('app-menu-popup', async (_event, menuIndex, position) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { handled: false };
    const menu = buildAppMenu(Number(menuIndex));
    const x = Number(position?.x), y = Number(position?.y);
    menu.popup({ window: win, ...(Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : {}) });
    return { handled: true };
  });

  ipcMain.on('quit-and-install', () => {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  });
}

module.exports = { registerIpcHandlers, ensureIpcListeners };
