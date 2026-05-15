const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (method, params = {}) => ipcRenderer.invoke('ipc-call', method, params),
  backendStatus: () => ipcRenderer.invoke('backend-status'),
  backendRestart: () => ipcRenderer.invoke('backend-restart'),
  onNotify: (callback) => {
    const listener = (event, method, params) => callback(method, params);
    ipcRenderer.on('ipc-notify', listener);
    return () => ipcRenderer.removeListener('ipc-notify', listener);
  },
  minimizeWindow: () => ipcRenderer.invoke('window-control', 'minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-control', 'maximize'),
  closeWindow: () => ipcRenderer.invoke('window-control', 'close'),
  showAppMenu: (menuIndex, position) => ipcRenderer.invoke('app-menu-popup', menuIndex, position),
});

window.addEventListener('error', (e) => {
  console.error('Renderer error:', e.error);
});
