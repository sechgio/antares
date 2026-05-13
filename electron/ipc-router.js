/**
 * IPC routing: request/response correlation, notifications forwarding.
 * Includes automatic retry when backend is temporarily unavailable.
 */
const { ipcMain, dialog } = require('electron');
const { handleDialogCall } = require('./dialog-handlers');
const { getProcess, isReady, waitForReady } = require('./backend-spawner');
const { getMainWindow, buildAppMenu } = require('./window-manager');

const _pendingRequests = new Map();
let _ipcListenersReady = false;

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

function _sendRequest(proc, method, params) {
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
}

const MAX_IPC_RETRIES = 3;
const IPC_RETRY_WAIT_MS = 5000;

function registerIpcHandlers() {
  ipcMain.handle('ipc-call', async (event, method, params) => {
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      throw new Error(`IPC method not allowed: ${method}`);
    }
    const win = getMainWindow();
    const { BrowserWindow } = require('electron');
    const dialogResult = await handleDialogCall(method, params, dialog, win, { BrowserWindow });
    if (dialogResult.handled) return dialogResult.result;

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_IPC_RETRIES; attempt++) {
      const proc = getProcess();
      if (proc && !proc.killed && isReady()) {
        try {
          return await _sendRequest(proc, method, params);
        } catch (err) {
          lastError = err;
          // If the error is about the process dying mid-request, retry after wait
          if (err.message.includes('Backend process exited') || err.message.includes('stdin write failed')) {
            console.warn(`[ipc-router] Attempt ${attempt}/${MAX_IPC_RETRIES} for "${method}" failed: ${err.message}`);
            if (attempt < MAX_IPC_RETRIES) {
              const ready = await waitForReady(IPC_RETRY_WAIT_MS);
              if (!ready) continue;
            }
            continue;
          }
          throw err;
        }
      }

      console.warn(`[ipc-router] Backend not ready, waiting (attempt ${attempt}/${MAX_IPC_RETRIES}) for "${method}"...`);
      const ready = await waitForReady(IPC_RETRY_WAIT_MS);
      if (ready) {
        const retryProc = getProcess();
        if (retryProc && !retryProc.killed) {
          try {
            return await _sendRequest(retryProc, method, params);
          } catch (err) {
            lastError = err;
            if (err.message.includes('Backend process exited') || err.message.includes('stdin write failed')) {
              continue;
            }
            throw err;
          }
        }
      }
      lastError = new Error('Backend no disponible');
    }

    throw lastError || new Error('Backend no disponible después de varios intentos');
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
    if (autoUpdater.isUpdaterActive?.() || autoUpdater.updateDownloaded) {
      autoUpdater.quitAndInstall();
    }
  });
}

module.exports = { registerIpcHandlers, ensureIpcListeners };
