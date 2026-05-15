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
const { handleDialogCall } = require('./dialog-handlers');
const {
  getProcess,
  isReady,
  waitForReady,
  getState,
  getLastError,
  getStderrTail,
  manualRestart,
  STATE,
} = require('./backend-spawner');
const { getMainWindow, buildAppMenu } = require('./window-manager');

const _pendingRequests = new Map();
let _attachedProcess = null;               // process instance we have listeners on

// Budgets
const REQUEST_TIMEOUT_MS = 30_000;         // per-request response timeout (default)
const LONG_REQUEST_TIMEOUT_MS = 300_000;   // 5 min for heavy operations (conversion, PDF generation, ZIP)
const STARTUP_WAIT_MS = 90_000;            // how long a call will wait for boot
const MID_FLIGHT_RETRIES = 2;              // retries for transient mid-flight errors

// Methods that can take a very long time (bulk conversion, PDF rendering, ZIP creation)
const LONG_RUNNING_METHODS = new Set([
  'process_start',
  'formatos_generate',
  'image_optimizer_zip',
  'technical_reports_render_consolidated_html',
  'technical_reports_render_html',
  'panel_aviso_corte_render_pdf',
  'panel_aviso_corte_compute_match',
  'html_to_pdf',
]);

/**
 * Allowlist of backend method names that can be called via IPC.
 * Only these methods are forwarded to the Python backend — any other
 * method name is rejected immediately, preventing arbitrary calls.
 */
const ALLOWED_METHODS = new Set([
  'version', 'formats', 'plugin_formats',
  'db_records', 'db_import', 'db_export', 'db_clear', 'db_template',
  'db_fields', 'db_fields_update', 'db_fields_reset',
  'rename_patterns_get', 'rename_patterns_update', 'rename_patterns_reset',
  'scan_folder',
  'process_start', 'process_status', 'process_cancel',
  'preview', 'preview_image', 'is_video',
  'formatos_list', 'formatos_generate', 'formatos_upload', 'formatos_delete', 'formatos_update_mapping',
  'history_list', 'history_get', 'history_delete', 'history_save',
  'technical_reports_list', 'technical_reports_get', 'technical_reports_create',
  'technical_reports_update', 'technical_reports_delete', 'technical_reports_clear',
  'technical_reports_import_file', 'technical_reports_variables',
  'technical_reports_autocomplete_cs', 'technical_reports_autocomplete_contratista',
  'technical_reports_render_html', 'technical_reports_render_consolidated_html', 'html_to_pdf',
  'panel_aviso_corte_parse_excel', 'panel_aviso_corte_compute_match',
  'panel_aviso_corte_render_pdf', 'panel_aviso_corte_template',
  'image_optimizer_zip',
  'jobs_list', 'jobs_get', 'jobs_cancel', 'jobs_cleanup',
  'theme_get', 'theme_save', 'theme_presets', 'theme_preset', 'theme_reset',
  'templates_list', 'template_get',
]);

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

  const id = Math.random().toString(36).slice(2);
  const request = { jsonrpc: '2.0', id, method, params };
  const timeoutMs = _getTimeoutForMethod(method);

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _pendingRequests.delete(id);
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
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
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
