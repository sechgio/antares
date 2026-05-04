const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { getBackendCommand } = require('./backend-command');
const { handleDialogCall } = require('./dialog-handlers');

const isDev = !app.isPackaged;

let mainWindow;
let pythonProcess = null;

function buildAppMenu(menuIndex = 0) {
  const menus = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Cerrar ventana', role: 'close' },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', role: 'reload' },
        { label: 'Herramientas de desarrollo', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Zoom real', role: 'resetZoom' },
        { label: 'Acercar', role: 'zoomIn' },
        { label: 'Alejar', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Pantalla completa', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Maximizar', click: () => mainWindow?.maximize() },
        { label: 'Restaurar', click: () => mainWindow?.unmaximize() },
        { type: 'separator' },
        { label: 'Cerrar', role: 'close' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Acerca de COSMO', role: 'about' },
      ],
    },
  ];

  return Menu.buildFromTemplate([menus[menuIndex] || menus[0]]);
}

async function startPythonBackend(attempt = 1) {
  try {
    await _startPythonBackend();
  } catch (err) {
    console.error(`Backend start attempt ${attempt} failed:`, err.message);
    if (attempt >= 3) {
      dialog.showErrorBox(
        'Error de inicio',
        'El backend no pudo iniciar después de 3 intentos. Intenta reiniciar la aplicación.'
      );
      app.quit();
      return;
    }
    const delay = Math.pow(2, attempt - 1) * 1000;
    await new Promise(r => setTimeout(r, delay));
    return startPythonBackend(attempt + 1);
  }
}

function _startPythonBackend() {
  let { cmd, args } = getBackendCommand(isDev, process.platform, __dirname);
  
  // Validate executable exists (for production) or is accessible (for dev)
  if (!isDev) {
    // In production, verify exe exists
    if (!fs.existsSync(cmd)) {
      throw new Error(`Backend executable not found: ${cmd}`);
    }
  } else {
    // In dev, check if venv exists, fallback to system python
    const venvPath = cmd;
    if (!fs.existsSync(venvPath)) {
      console.warn(`Venv Python not found at ${venvPath}, trying system python...`);
      const systemPython = process.platform === 'win32' ? 'python.exe' : 'python3';
      cmd = systemPython;
      // Verify system python is available in PATH
      try {
        require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
      } catch {
        throw new Error(`Python no encontrado: ni el entorno virtual (${venvPath}) ni Python del sistema (${cmd}) están disponibles. Instala Python o configura el entorno virtual.`);
      }
    }
  }
  
  pythonProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error('[Python]', data.toString().trim());
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python backend:', err);
    const isNotFound = err.code === 'ENOENT';
    const message = isNotFound
      ? `Python no encontrado: verifica que el entorno virtual o Python del sistema esté instalado.\n${err.message}`
      : `No se pudo iniciar el backend Python:\n${err.message}`;
    dialog.showErrorBox('Backend Error', message);
    app.quit();
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'ready') {
            pythonProcess.stdout.off('data', onData);
            setupNotificationListener();
            resolve();
            return;
          }
        } catch {
          // Not JSON, ignore
        }
      }
    };
    pythonProcess.stdout.on('data', onData);
    setTimeout(() => reject(new Error('Python backend timeout')), 30000);
  });
}

// Single permanent notification listener for Python stdout
function setupNotificationListener() {
  let notifyBuffer = '';
  pythonProcess.stdout.on('data', (data) => {
    notifyBuffer += data.toString();
    const lines = notifyBuffer.split('\n');
    notifyBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Notifications have method + params but no id
        if (msg.method && msg.params && msg.id === undefined) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ipc-notify', msg.method, msg.params);
          }
        }
      } catch {
        // Not a notification, ignore
      }
    }
  });
}

// IPC bridge: frontend -> main -> Python -> main -> frontend
ipcMain.handle('ipc-call', async (event, method, params) => {
  const dialogResult = await handleDialogCall(method, params, dialog, mainWindow, { BrowserWindow });
  if (dialogResult.handled) {
    return dialogResult.result;
  }

  if (!pythonProcess || pythonProcess.killed) {
    throw new Error('Backend no disponible');
  }

  const id = Math.random().toString(36).slice(2);
  const request = { jsonrpc: '2.0', id, method, params };

  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            pythonProcess.stdout.off('data', onData);
            clearTimeout(timeoutId);
            if (msg.error) {
              reject(new Error(msg.error.message || msg.error));
            } else {
              resolve(msg.result);
            }
            return;
          }
        } catch {
          // Not JSON or not our response, ignore
        }
      }
    };
    pythonProcess.stdout.on('data', onData);

    pythonProcess.stdin.write(JSON.stringify(request) + '\n');

    const timeoutId = setTimeout(() => {
      pythonProcess.stdout.off('data', onData);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ipc-notify', 'ipc.error', { message: 'IPC timeout: backend no responde' });
      }
      reject(new Error('IPC timeout'));
    }, 30000);
  });
});

ipcMain.handle('window-control', async (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { handled: false };

  if (action === 'minimize') {
    mainWindow.minimize();
    return { handled: true };
  }

  if (action === 'maximize') {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { handled: true, maximized: mainWindow.isMaximized() };
  }

  if (action === 'close') {
    mainWindow.close();
    return { handled: true };
  }

  return { handled: false };
});

ipcMain.handle('app-menu-popup', async (_event, menuIndex, position) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { handled: false };

  const menu = buildAppMenu(Number(menuIndex));
  const x = Number(position?.x);
  const y = Number(position?.y);
  menu.popup({
    window: mainWindow,
    ...(Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : {}),
  });

  return { handled: true };
});

// Auto-updater events
autoUpdater.on('update-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err);
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Prevent background throttling for smoother IPC
  mainWindow.webContents.setBackgroundThrottling(false);

  mainWindow.maximize();

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, the app is packaged in app.asar; resolve the HTML entry
    const htmlPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    console.log('[Electron] Loading production HTML:', htmlPath);
    mainWindow.loadFile(htmlPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    // Start backend and create window in parallel for faster startup
    createWindow();
    await startPythonBackend();
    // Check for updates in production
    if (!isDev) {
      autoUpdater.checkForUpdates();
    }
  } catch (err) {
    dialog.showErrorBox('Error de inicio', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.stdin.end();
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
