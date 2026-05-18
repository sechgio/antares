/**
 * Window management: BrowserWindow creation and lifecycle.
 */
const { BrowserWindow, screen, session, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let _isDev = false;

function buildAppMenu(menuIndex = 0) {
  const menus = [
    { label: 'Archivo', submenu: [{ label: 'Cerrar ventana', role: 'close' }, { type: 'separator' }, { label: 'Salir', role: 'quit' }] },
    { label: 'Editar', submenu: [{ label: 'Deshacer', role: 'undo' }, { label: 'Rehacer', role: 'redo' }, { type: 'separator' }, { label: 'Cortar', role: 'cut' }, { label: 'Copiar', role: 'copy' }, { label: 'Pegar', role: 'paste' }, { label: 'Seleccionar todo', role: 'selectAll' }] },
    { label: 'Ver', submenu: [{ label: 'Recargar', role: 'reload' }, { label: 'Herramientas de desarrollo', role: 'toggleDevTools' }, { type: 'separator' }, { label: 'Zoom real', role: 'resetZoom' }, { label: 'Acercar', role: 'zoomIn' }, { label: 'Alejar', role: 'zoomOut' }, { type: 'separator' }, { label: 'Pantalla completa', role: 'togglefullscreen' }] },
    { label: 'Ventana', submenu: [{ label: 'Minimizar', role: 'minimize' }, { label: 'Maximizar', click: () => mainWindow?.maximize() }, { label: 'Restaurar', click: () => mainWindow?.unmaximize() }, { type: 'separator' }, { label: 'Cerrar', role: 'close' }] },
    { label: 'Ayuda', submenu: [{ label: 'Acerca de Antares', role: 'about' }] },
  ];
  return Menu.buildFromTemplate([menus[menuIndex] || menus[0]]);
}

function createWindow(isDev) {
  _isDev = !!isDev;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width, height, show: false, frame: false,
    titleBarStyle: 'hidden', autoHideMenuBar: true, icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  // Set Content-Security-Policy to prevent XSS → RCE escalation
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' http://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-inline'; style-src 'self' 'unsafe-inline' http://localhost:5173; img-src 'self' data: blob: http://localhost:5173; font-src 'self' http://localhost:5173; connect-src 'self' http://localhost:5173 ws://localhost:5173"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'"
        ]
      }
    });
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.maximize();

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Only open DevTools when explicitly in dev mode AND app is not packaged
    if (!require('electron').app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    const htmlPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    mainWindow.loadFile(htmlPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() { return mainWindow; }
function getIsDev() { return _isDev; }

module.exports = { createWindow, getMainWindow, getIsDev, buildAppMenu };
