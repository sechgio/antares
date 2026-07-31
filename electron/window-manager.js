/**
 * Window management: BrowserWindow creation and lifecycle.
 */
const { BrowserWindow, screen, session, Menu } = require('electron');
const path = require('path');
const { ALLOWED_RENDERER_METHODS } = require('./ipc-methods');

let mainWindow = null;
let _isDev = false;

function buildAppMenu(menuIndex = 0) {
  const isPackaged = (() => {
    try {
      return !!require('electron').app.isPackaged;
    } catch {
      return false;
    }
  })();
  const viewSubmenu = [
    { label: 'Recargar', role: 'reload' },
    ...(!isPackaged ? [{ label: 'Herramientas de desarrollo', role: 'toggleDevTools' }] : []),
    { type: 'separator' },
    { label: 'Zoom real', role: 'resetZoom' },
    { label: 'Acercar', role: 'zoomIn' },
    { label: 'Alejar', role: 'zoomOut' },
    { type: 'separator' },
    { label: 'Pantalla completa', role: 'togglefullscreen' },
  ];
  const menus = [
    { label: 'Archivo', submenu: [{ label: 'Cerrar ventana', role: 'close' }, { type: 'separator' }, { label: 'Salir', role: 'quit' }] },
    { label: 'Editar', submenu: [{ label: 'Deshacer', role: 'undo' }, { label: 'Rehacer', role: 'redo' }, { type: 'separator' }, { label: 'Cortar', role: 'cut' }, { label: 'Copiar', role: 'copy' }, { label: 'Pegar', role: 'paste' }, { label: 'Seleccionar todo', role: 'selectAll' }] },
    { label: 'Ver', submenu: viewSubmenu },
    { label: 'Ventana', submenu: [{ label: 'Minimizar', role: 'minimize' }, { label: 'Maximizar', click: () => mainWindow?.maximize() }, { label: 'Restaurar', click: () => mainWindow?.unmaximize() }, { type: 'separator' }, { label: 'Cerrar', role: 'close' }] },
    { label: 'Ayuda', submenu: [{ label: 'Acerca de Antares', role: 'about' }] },
  ];
  return Menu.buildFromTemplate([menus[menuIndex] || menus[0]]);
}

function createWindow(isDev) {
  _isDev = !!isDev;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  // The preload runs with sandbox: true, so it cannot `require('./ipc-methods')`
  // (sandboxed preloads can only require a small set of built-ins). Inject the
  // IPC allowlist via additionalArguments — the canonical way to pass small,
  // trusted data into a sandboxed preload. ipc-methods.js stays the single
  // source of truth (still required by the main-process ipc-router, which is
  // the real security boundary).
  // Re-resolve from the shared module so createWindow always gets the current Set
  // (including methods added after this file was first required in long-lived tooling).
  const { ALLOWED_RENDERER_METHODS: allowedNow } = require('./ipc-methods');
  const allowedList = [...allowedNow];
  const allowedMethodsArg = `--allowed-ipc-methods=${JSON.stringify(allowedList)}`;
  // `app.isPackaged` marcador fiable de build empaquetado, inyectado al preload
  // (sandbox: true => sin acceso a `app` ni `__dirname` allá).
  const isPackagedArg = `--app-is-packaged=${isDev ? '0' : '1'}`;

  mainWindow = new BrowserWindow({
    width, height, show: false, frame: false,
    titleBarStyle: 'hidden', autoHideMenuBar: true, icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [allowedMethodsArg, isPackagedArg],
    },
  });

  // Set Content-Security-Policy to prevent XSS → RCE escalation
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            // wss://*.supabase.co is required for Supabase Realtime (Espacios live sync).
            // https: does NOT imply wss: under CSP scheme matching.
            ? "default-src 'self' http://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-inline'; style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; img-src 'self' data: blob: http://localhost:5173 https://assets.petdex.dev; font-src 'self' http://localhost:5173 https://fonts.gstatic.com; connect-src 'self' http://localhost:5173 ws://localhost:5173 wss://yoyxclndjevkzzclhdcv.supabase.co https://yoyxclndjevkzzclhdcv.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com https://petdex.dev https://assets.petdex.dev"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://assets.petdex.dev; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss://yoyxclndjevkzzclhdcv.supabase.co https://yoyxclndjevkzzclhdcv.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com https://petdex.dev https://assets.petdex.dev"
        ]
      }
    });
  });

  mainWindow.webContents.setBackgroundThrottling(false);

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? (url.startsWith('http://localhost:5173') || url.startsWith('http://127.0.0.1:5173'))
      : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() { return mainWindow; }
function getIsDev() { return _isDev; }

module.exports = { createWindow, getMainWindow, getIsDev, buildAppMenu };
