/**
 * Python backend process lifecycle: spawn, handshake, kill, auto-restart.
 */
const { dialog } = require('electron');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { getBackendCommand } = require('./backend-command');

let pythonProcess = null;
let _isReady = false;
let _isDev = false;
let _isShuttingDown = false;
let _restartCount = 0;
const MAX_AUTO_RESTARTS = 3;
const RESTART_RESET_MS = 60000; // reset restart counter after 1 min of stability
let _restartResetTimer = null;

// Promise-based readiness gate: resolves when backend is ready
let _readyResolve = null;
let _readyReject = null;
let _readyPromise = _createReadyPromise();

function _createReadyPromise() {
  return new Promise((resolve, reject) => { _readyResolve = resolve; _readyReject = reject; });
}

function getProcess() { return pythonProcess; }
function isReady() { return _isReady; }

/**
 * Wait until the backend is ready (or already is).
 * Returns true if ready, false if timed out.
 */
async function waitForReady(timeoutMs = 35000) {
  if (_isReady && pythonProcess && !pythonProcess.killed) return true;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const ready = _readyPromise.then(() => true).catch(() => false);
  return Promise.race([ready, timeout]);
}

async function startPythonBackend(isDev, attempt = 1) {
  _isDev = isDev;
  _isShuttingDown = false;
  try {
    await _spawn(isDev);
    _isReady = true;
    _readyResolve?.();
    // Reset restart counter after a period of stability
    if (_restartResetTimer) clearTimeout(_restartResetTimer);
    _restartResetTimer = setTimeout(() => { _restartCount = 0; }, RESTART_RESET_MS);
  } catch (err) {
    console.error(`Backend start attempt ${attempt} failed:`, err.message);
    if (attempt >= 3) {
      dialog.showErrorBox('Error de inicio', 'El backend no pudo iniciar después de 3 intentos. Intenta reiniciar la aplicación.');
      const { app } = require('electron');
      app.quit();
      return;
    }
    await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    return startPythonBackend(isDev, attempt + 1);
  }
}

async function _autoRestart() {
  if (_isShuttingDown) return;
  _restartCount++;
  console.warn(`[backend-spawner] Auto-restart attempt ${_restartCount}/${MAX_AUTO_RESTARTS}`);

  if (_restartCount > MAX_AUTO_RESTARTS) {
    console.error('[backend-spawner] Max auto-restarts exceeded, giving up.');
    const { getMainWindow } = require('./window-manager');
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('ipc-notify', 'backend.fatal', {
        message: 'El backend se cerró inesperadamente y no se pudo reiniciar. Reinicia la aplicación.',
      });
    }
    // Resolve orphaned waiters so they don't hang forever
    if (_readyResolve) {
      try { _readyResolve(undefined); } catch {}
    }
    return;
  }

  // Reject previous waiters and reset the ready gate
  if (_readyReject) {
    try { _readyReject(new Error('Backend restarting')); } catch {}
  }
  _readyPromise = _createReadyPromise();

  // Notify renderer that backend is restarting
  const { getMainWindow } = require('./window-manager');
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('ipc-notify', 'backend.restarting', {
      message: 'Backend reiniciándose...',
      attempt: _restartCount,
    });
  }

  await new Promise(r => setTimeout(r, 1000 * _restartCount)); // progressive backoff
  await startPythonBackend(_isDev);
}

function _spawn(isDev) {
  let { cmd, args } = getBackendCommand(isDev, process.platform, __dirname);

  if (!isDev) {
    if (!fs.existsSync(cmd)) throw new Error(`Backend executable not found: ${cmd}`);
  } else {
    if (!fs.existsSync(cmd)) {
      console.warn(`Venv Python not found at ${cmd}, trying system python...`);
      const systemPython = process.platform === 'win32' ? 'python.exe' : 'python3';
      cmd = systemPython;
      try { execSync(`${cmd} --version`, { stdio: 'ignore' }); } catch {
        throw new Error(`Python no encontrado: ni el entorno virtual ni Python del sistema están disponibles.`);
      }
    }
  }

  pythonProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  pythonProcess.stderr.on('data', (data) => console.error('[Python]', data.toString().trim()));
  pythonProcess.stdin.on('error', (err) => console.error('[Python stdin error]', err.message));

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
    const wasReady = _isReady;
    pythonProcess = null;
    _isReady = false;

    // If it was running fine and crashed unexpectedly, auto-restart
    if (wasReady && !_isShuttingDown) {
      console.warn('[backend-spawner] Unexpected backend exit, triggering auto-restart...');
      _autoRestart().catch((err) => console.error('[backend-spawner] Auto-restart failed:', err));
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python backend:', err);
    const msg = err.code === 'ENOENT'
      ? `Python no encontrado: verifica que el entorno virtual o Python del sistema esté instalado.\n${err.message}`
      : `No se pudo iniciar el backend Python:\n${err.message}`;
    dialog.showErrorBox('Backend Error', msg);
    const { app } = require('electron');
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
            resolve();
            return;
          }
        } catch { /* Not JSON */ }
      }
    };
    pythonProcess.stdout.on('data', onData);
    setTimeout(() => {
      pythonProcess?.stdout.off('data', onData);
      if (pythonProcess && !pythonProcess.killed) pythonProcess.kill();
      reject(new Error('Python backend timeout'));
    }, 30000);
  });
}

function killPython() {
  _isShuttingDown = true;
  _isReady = false;
  if (_restartResetTimer) clearTimeout(_restartResetTimer);
  if (pythonProcess && !pythonProcess.killed) {
    try { pythonProcess.stdin.end(); } catch {}
    pythonProcess.kill();
  }
}

module.exports = { startPythonBackend, getProcess, killPython, isReady, waitForReady };
