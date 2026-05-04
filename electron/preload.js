const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (method, params = {}) => ipcRenderer.invoke('ipc-call', method, params),
  onNotify: (callback) => {
    const listener = (event, method, params) => callback(method, params);
    ipcRenderer.on('ipc-notify', listener);
    return () => ipcRenderer.removeListener('ipc-notify', listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),
  minimizeWindow: () => ipcRenderer.invoke('window-control', 'minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-control', 'maximize'),
  closeWindow: () => ipcRenderer.invoke('window-control', 'close'),
  showAppMenu: (menuIndex, position) => ipcRenderer.invoke('app-menu-popup', menuIndex, position),
});

window.addEventListener('error', (e) => {
  console.error('Renderer error:', e.error);
});
