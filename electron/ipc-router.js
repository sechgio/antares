/**
 * IPC router: JSON-RPC request/response correlation between renderer and
 * the Python backend, plus notification forwarding.
 *
 * Design goals:
 *   - A request issued before the backend finishes booting **waits** for it
 *     (bounded by a generous startup budget) instead of failing with a
 *     cryptic "Backend no disponible".
 *   - Failures include a meaningful reason: handshake timeout, Python
 *     crashed with stderr, executable missing, etc.
 *   - Mid-flight transient failures (process died while we were waiting
 *     for a response) retry a small, bounded number of times.
 */
const { ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const { handleDialogCall } = require('./dialog-handlers');
const { ALLOWED_RENDERER_METHODS, LONG_RUNNING_METHODS } = require('./ipc-methods');
const {
  getProcess,
  isReady,
  waitForReady,
  getState,
  getLastError,
  getStderrTail,
  manualRestart,
  incrementPendingRequests,
  decrementPendingRequests,
  STATE,
} = require('./backend-spawner');
const { getMainWindow, buildAppMenu } = require('./window-manager');

const _pendingRequests = new Map();
let _attachedProcess = null;               // process instance we have listeners on

// Budgets
const REQUEST_TIMEOUT_MS = 30_000;         // per-request response timeout — most ops finish in <5s
const LONG_REQUEST_TIMEOUT_MS = 900_000;   // 15 min for heavy operations (large PDF/ZIP batches)
const STARTUP_WAIT_MS = 30_000;            // backend should start in <10s; 30s is a safe margin
const MID_FLIGHT_RETRIES = 2;              // retries for transient mid-flight errors

/**
 * Allowlist of backend method names that can be called via IPC.
 * Only these methods are forwarded to the Python backend — any other
 * method name is rejected immediately, preventing arbitrary calls.
 */
/**
 * Attach stdout/close listeners to the current backend process if we haven't
 * already. Re-runs whenever the backend is restarted.
 */
function _ensureListeners() {
  const proc = getProcess();
  if (!proc) return false;
  if (_attachedProcess === proc) return true;

  _attachedProcess = proc;
  let buffer = '';

  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Notification (no `id`): forward to renderer
        if (msg.method && msg.params !== undefined && msg.id === undefined) {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', msg.method, msg.params);
          continue;
        }
        // Response to a pending request
        if (msg.id !== undefined && _pendingRequests.has(String(msg.id))) {
          const entry = _pendingRequests.get(String(msg.id));
          clearTimeout(entry.timeout);
          _pendingRequests.delete(String(msg.id));
          decrementPendingRequests();
          if (msg.error) {
            const errMsg = typeof msg.error === 'object' ? (msg.error.message || JSON.stringify(msg.error)) : String(msg.error);
            entry.reject(new Error(errMsg));
          } else {
            entry.resolve(msg.result);
          }
        }
      } catch { /* malformed line — ignore */ }
    }
  });

  proc.on('close', () => {
    _attachedProcess = null;
    for (const [, entry] of _pendingRequests) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Backend process exited while waiting for response'));
      decrementPendingRequests();
    }
    _pendingRequests.clear();
  });

  return true;
}

function _getTimeoutForMethod(method) {
  return LONG_RUNNING_METHODS.has(method) ? LONG_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

function _sendRequest(method, params) {
  const proc = getProcess();
  if (!proc || proc.killed) {
    return Promise.reject(new Error('Backend process not available'));
  }
  _ensureListeners();

  const id = crypto.randomUUID();
  const request = { jsonrpc: '2.0', id, method, params };
  const timeoutMs = _getTimeoutForMethod(method);

  incrementPendingRequests();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _pendingRequests.delete(id);
      decrementPendingRequests();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ipc-notify', 'ipc.error', {
          method,
          message: `IPC timeout: el backend no respondió a "${method}" en ${timeoutMs / 1000}s`,
        });
      }
      reject(new Error(`IPC timeout: ${method}`));
    }, timeoutMs);

    _pendingRequests.set(id, { resolve, reject, timeout: timeoutId });
    try {
      proc.stdin.write(JSON.stringify(request) + '\n');
    } catch (err) {
      clearTimeout(timeoutId);
      _pendingRequests.delete(id);
      decrementPendingRequests();
      reject(new Error(`Backend stdin write failed: ${err.message}`));
    }
  });
}

/**
 * Build a user-facing error message when the backend is not available.
 * Pulls detail from the spawner so the renderer sees what actually happened.
 */
function _buildUnavailableError() {
  const state = getState();
  const last = getLastError();
  const tail = getStderrTail();

  if (state === STATE.FATAL) {
    const base = last?.message || 'El backend no pudo iniciarse.';
    const suffix = tail ? `\n\nDetalle:\n${tail}` : '';
    const err = new Error(`${base}${suffix}`);
    err.code = 'BACKEND_FATAL';
    return err;
  }
  if (state === STATE.STARTING) {
    const err = new Error('El backend todavía se está iniciando. Intenta de nuevo en unos segundos.');
    err.code = 'BACKEND_STARTING';
    return err;
  }
  if (state === STATE.EXITED) {
    const suffix = tail ? `\n\nÚltima salida:\n${tail}` : '';
    const err = new Error(`El backend se cerró inesperadamente.${suffix}`);
    err.code = 'BACKEND_EXITED';
    return err;
  }
  const err = new Error('Backend no disponible (estado desconocido).');
  err.code = 'BACKEND_UNAVAILABLE';
  return err;
}

/**
 * Call a backend method, waiting for boot if necessary, with a small number
 * of retries if the process dies mid-flight.
 */
async function _callBackend(method, params) {
  // 1. Wait for ready (or fatal). This is the ONLY place we block for boot.
  if (!isReady()) {
    if (getState() === STATE.FATAL) throw _buildUnavailableError();
    const ready = await waitForReady(STARTUP_WAIT_MS);
    if (!ready) throw _buildUnavailableError();
  }

  // 2. Send, retrying on transient mid-flight failures.
  let lastErr = null;
  for (let attempt = 0; attempt <= MID_FLIGHT_RETRIES; attempt++) {
    try {
      _ensureListeners();
      return await _sendRequest(method, params);
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      const transient = msg.includes('Backend process exited')
        || msg.includes('Backend process not available')
        || msg.includes('stdin write failed');
      if (!transient || attempt === MID_FLIGHT_RETRIES) throw err;

      console.warn(`[ipc-router] "${method}" transient failure (attempt ${attempt + 1}/${MID_FLIGHT_RETRIES + 1}): ${msg}. Waiting for backend...`);
      const ready = await waitForReady(STARTUP_WAIT_MS);
      if (!ready) throw _buildUnavailableError();
    }
  }
  throw lastErr || _buildUnavailableError();
}

function registerIpcHandlers() {
  ipcMain.handle('ipc-call', async (event, method, params) => {
    if (typeof method !== 'string' || !ALLOWED_RENDERER_METHODS.has(method)) {
      throw new Error(`IPC method not allowed: ${method}`);
    }

    // Dialog / native methods are handled in Electron main without touching Python.
    const win = getMainWindow();
    const { BrowserWindow } = require('electron');
    const dialogResult = await handleDialogCall(method, params, dialog, win, { BrowserWindow });
    if (dialogResult.handled) return dialogResult.result;

    return _callBackend(method, params);
  });

  ipcMain.handle('backend-status', async () => {
    return {
      state: getState(),
      ready: isReady(),
      lastError: getLastError(),
      stderrTail: getStderrTail(),
    };
  });

  ipcMain.handle('backend-restart', async () => {
    const { getIsDev } = require('./window-manager');
    // Fallback: determine isDev from app if window-manager doesn't export it
    let isDev;
    try {
      isDev = getIsDev();
    } catch {
      isDev = !require('electron').app.isPackaged;
    }
    const ok = await manualRestart(isDev);
    return { success: ok, state: getState() };
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
    const x = Number(position?.x);
    const y = Number(position?.y);
    menu.popup({
      window: win,
      ...(Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : {}),
    });
    return { handled: true };
  });
}

module.exports = { registerIpcHandlers, _ensureListeners };
