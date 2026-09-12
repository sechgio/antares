const { BrowserWindow, screen, Menu } = require('electron');
const path = require('path');
const { appendLogEvent } = require('./app-log');

let mainWindow = null;
let _isDev = false;

function _resolvePinnedSupabaseHost() {
  const raw = process.env.ANTARES_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (!raw) return null;
  try {
    const url = new URL(String(raw).trim());
    const host = url.hostname;
    if (url.protocol === 'https:' && /(^|\.)supabase\.co$/i.test(host)) {
      return host;
    }
  } catch {
  }
  return null;
}

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

  const { ALLOWED_RENDERER_METHODS: allowedNow } = require('./ipc-methods');
  const allowedList = [...allowedNow];
  const allowedMethodsArg = `--allowed-ipc-methods=${JSON.stringify(allowedList)}`;
  const isPackagedArg = `--app-is-packaged=${isDev ? '0' : '1'}`;

  mainWindow = new BrowserWindow({
    width, height, show: false, frame: false,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hidden', autoHideMenuBar: true, icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [allowedMethodsArg, isPackagedArg],
    },
  });

  const cspHardening = "; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const pinnedSupabaseHost = _resolvePinnedSupabaseHost();
  const buildCsp = (policy) => {
    const pinned = pinnedSupabaseHost ? policy.replace(/\*\.supabase\.co/g, pinnedSupabaseHost) : policy;
    return pinned + cspHardening;
  };

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? buildCsp("default-src 'self' http://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-inline'; style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; img-src 'self' data: blob: http://localhost:5173 https://assets.petdex.dev; font-src 'self' http://localhost:5173 https://fonts.gstatic.com; connect-src 'self' http://localhost:5173 ws://localhost:5173 wss://*.supabase.co https://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com https://petdex.dev https://assets.petdex.dev")
            : buildCsp("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://assets.petdex.dev; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss://*.supabase.co https://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com https://petdex.dev https://assets.petdex.dev")
        ]
      }
    });
  });

  mainWindow.webContents.setBackgroundThrottling(false);

  const htmlPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  let loadFailureRecoveryAttempts = 0;
  const loadMainWindowContent = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
    return isDev
      ? mainWindow.loadURL('http://localhost:5173')
      : mainWindow.loadFile(htmlPath);
  };
  const showLoadFailurePage = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const html = '<!doctype html><meta charset="utf-8"><title>Antares</title>' +
      '<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center}main{max-width:34rem;padding:2rem}h1{font-size:1.35rem}p{color:#94a3b8}</style>' +
      '<main><h1>Antares no pudo cargar la aplicación</h1><p>Usa Ver → Recargar para reintentar.</p></main>';
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
  };

  mainWindow.webContents.on('render-process-gone', (_event, details = {}) => {
    appendLogEvent('ERROR', 'renderer.lifecycle', {
      component: 'renderer',
      outcome: 'failed',
      reason: details.reason || 'render_process_gone',
      message: `exit_code=${Number.isInteger(details.exitCode) ? details.exitCode : 'unknown'}`,
    });
  });
  mainWindow.webContents.on('unresponsive', () => {
    appendLogEvent('WARN', 'renderer.lifecycle', {
      component: 'renderer',
      outcome: 'degraded',
      reason: 'unresponsive',
    });
  });
  mainWindow.webContents.on('responsive', () => {
    appendLogEvent('INFO', 'renderer.lifecycle', {
      component: 'renderer',
      outcome: 'success',
      reason: 'responsive',
    });
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    appendLogEvent('ERROR', 'renderer.lifecycle', {
      component: 'renderer',
      outcome: 'failed',
      reason: 'load_failed',
      error_code: String(errorCode),
      message: errorDescription || 'renderer load failed',
    });
    if (!isMainFrame || errorCode === -3 || !mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.show();
    if (loadFailureRecoveryAttempts < 1) {
      loadFailureRecoveryAttempts += 1;
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        void loadMainWindowContent().catch(() => {
          showLoadFailurePage();
        });
      }, 250);
    } else {
      showLoadFailurePage();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  const { pathToFileURL } = require('url');
  const distFileUrlPrefix = pathToFileURL(path.dirname(htmlPath) + path.sep).toString();

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? (url.startsWith('http://localhost:5173') || url.startsWith('http://127.0.0.1:5173'))
      : url.startsWith(distFileUrlPrefix);
    if (!allowed) event.preventDefault();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    loadFailureRecoveryAttempts = 0;
  });

  // A load that neither finishes nor reports did-fail-load would leave the
  // window hidden forever; reveal it (or the failure page) as a fallback.
  const loadWatchdog = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    appendLogEvent('WARN', 'renderer.lifecycle', {
      component: 'renderer',
      outcome: 'degraded',
      reason: 'ready_to_show_timeout',
    });
    mainWindow.show();
    if (!mainWindow.webContents.isLoadingMainFrame()) showLoadFailurePage();
  }, 20_000);

  void loadMainWindowContent().catch(() => {
    showLoadFailurePage();
  });
  if (isDev && !require('electron').app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    clearTimeout(loadWatchdog);
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() { return mainWindow; }
function getIsDev() { return _isDev; }

module.exports = { createWindow, getMainWindow, getIsDev, buildAppMenu };
