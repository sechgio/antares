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
const {
  getProcess,
  isReady,
  waitForReady,
  getState,
  getHealthStatus,
  getLastError,
  getStderrTail,
  manualRestart,
  incrementPendingRequests,
  decrementPendingRequests,
  noteJobActivity,
  clearJobActivity,
  STATE,
} = require('./backend-spawner');
const { getMainWindow, buildAppMenu } = require('./window-manager');
const { appendLogEvent } = require('./app-log');
const { isTrustedRendererFrame } = require('./renderer-trust');
const {
  _maybeResolveFileTokens,
  _collectStagedTokens,
  _cleanupStagedTokens,
  _validateAndResolveWriteParams,
} = require('./ipc-file-policy');

const _pendingRequests = new Map();
const _pendingMethodCounts = new Map();
let _pendingRequestCount = 0;
let _attachedProcess = null;               // process instance we have listeners on

/** Cached IPC allowlist. reloadIpcMethods() busts cache in dev. */
let _ipcMethodsCache = null;

function _loadIpcMethods() {
  if (_ipcMethodsCache) return _ipcMethodsCache;
  _ipcMethodsCache = require('./ipc-methods');
  return _ipcMethodsCache;
}

function reloadIpcMethods() {
  const modules = [
    './ipc-methods',
    './autoimg-ipc-methods',
    './ubicaciones-ipc-methods',
    '../shared/long-running-methods.json',
    '../shared/heavy-ipc-methods.json',
  ];
  for (const rel of modules) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch {
      // ignore missing modules
    }
  }
  _ipcMethodsCache = null;
  return _loadIpcMethods();
}

function _getAllowedMethods() {
  return _loadIpcMethods().ALLOWED_RENDERER_METHODS;
}

function _getLongRunningMethods() {
  return _loadIpcMethods().LONG_RUNNING_METHODS;
}

function _getHeavyMethods() {
  return _loadIpcMethods().HEAVY_METHODS;
}

const REQUEST_TIMEOUT_MS = 30_000;
const LONG_REQUEST_TIMEOUT_MS = 300_000;
const LONG_REQUEST_TIMEOUT_MS_HEAVY = 900_000;
const STARTUP_WAIT_MS = 60_000;
const MID_FLIGHT_RETRIES = 2;
const BACKEND_RESTART_MIN_INTERVAL_MS = 5_000;
const IPC_TELEMETRY_SLOW_MS = 5_000;
const IPC_TELEMETRY_LARGE_BYTES = 1 * 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 64;
const DEFAULT_MAX_PENDING_PER_METHOD = 8;

function _positiveIntegerEnv(name, fallback) {
  const raw = Number(process.env[name]);
  if (!Number.isSafeInteger(raw) || raw <= 0) return fallback;
  return Math.min(raw, 256);
}

const MAX_PENDING_REQUESTS = _positiveIntegerEnv(
  'ANTARES_IPC_MAX_PENDING_REQUESTS',
  DEFAULT_MAX_PENDING_REQUESTS,
);
const MAX_PENDING_PER_METHOD = _positiveIntegerEnv(
  'ANTARES_IPC_MAX_PENDING_PER_METHOD',
  DEFAULT_MAX_PENDING_PER_METHOD,
);
const IPC_CAPACITY_RETRY_AFTER_MS = 250;

let _ipcBackpressureWaits = 0;
/** Prefix for structured IPC errors embedded in Error.message (Electron only clones message). */
const ANTARES_IPC_ERROR_PREFIX = 'ANTARES_IPC_ERROR:';

/** Encode error fields inside Error.message for ipcMain.handle. */
function _toRendererIpcError(err) {
  const payload = {
    message: err && err.message ? String(err.message) : String(err),
    code: err && err.code !== undefined ? err.code : -32000,
    category: err && err.category !== undefined ? err.category : 'INTERNAL_ERROR',
    details: err && err.details !== undefined ? err.details : undefined,
  };
  return new Error(ANTARES_IPC_ERROR_PREFIX + JSON.stringify(payload));
}

/** Only idempotent reads are safe to retry. Explicit allowlist — never heuristic. */
const IDEMPOTENT_METHODS = new Set([
  'version',
  'formats',
  'preview',
  'is_video',
  'process_status',
  'db_records',
  'db_columns',
  'db_fields',
  'db_template',
  'db_parse_mapping',
  'db_validate_mapping',
  'db_detect_key_column',
  'theme_presets',
  'theme_preset',
  'panel_aviso_corte_template',
  'canvas_list',
  'canvas_get',
  'canvas_get_history',
  'espacios_list',
  'espacios_get',
]);

function _isIdempotentMethod(method) {
  if (typeof method !== 'string') return false;
  if (IDEMPOTENT_METHODS.has(method)) return true;
  if (method.includes('_autocomplete_')) return true;
  return false;
}

let _lastBackendRestartAt = 0;

function _isAllowedIpcSender(event) {
  let isDev;
  try {
    isDev = require('./window-manager').getIsDev();
  } catch {
    try {
      isDev = !require('electron').app.isPackaged;
    } catch {
      isDev = false;
    }
  }
  return isTrustedRendererFrame(event, getMainWindow(), isDev);
}

function _handleBackendTermination(proc) {
  // `exit` is emitted as soon as the child is gone. `close` follows after all
  // stdio streams close, which can be delayed by a stuck pipe. Both events can
  // arrive, so deleting the entry before rejecting makes this idempotent.
  for (const [id, entry] of _pendingRequests) {
    if (entry.proc !== proc) continue;
    clearTimeout(entry.timeout);
    _pendingRequests.delete(id);
    entry.reject(new Error('Backend process exited while waiting for response'));
    entry.releasePending();
  }

  if (_attachedProcess !== proc) return;
  _attachedProcess = null;
  clearJobActivity();
}

/** Frame NDJSON lines from stdout without string-concat. Caps pending at maxPendingBytes. */
function _consumeStdoutLines(pending, chunk, maxPendingBytes = Infinity) {
  const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  // Normalize pending to list form for zero-copy scan
  let bufs;
  let totalLen;
  const isObjectPending = pending && typeof pending === 'object' && Array.isArray(pending.bufs);
  if (isObjectPending) {
    bufs = pending.bufs;
    totalLen = pending.len;
  } else {
    bufs = !pending || pending.length === 0 ? [] : [pending];
    totalLen = !pending ? 0 : pending.length;
  }
  bufs.push(piece);
  totalLen += piece.length;

  // Pending has no newline; if the new piece also has none, no lines can form.
  if (piece.indexOf(0x0a) === -1) {
    const pendingRemLen = totalLen;
    let dropped = false;
    if (pendingRemLen > maxPendingBytes) {
      dropped = true;
      const empty = isObjectPending ? { bufs: [], len: 0 } : Buffer.alloc(0);
      return { pending: empty, lines: [], dropped };
    }
    if (isObjectPending) {
      return { pending: { bufs, len: totalLen }, lines: [], dropped };
    }
    // Legacy Buffer path — need to materialize pending as single Buffer
    // but avoid extra copy when pending was empty
    if (bufs.length === 1) return { pending: bufs[0], lines: [], dropped };
    return { pending: Buffer.concat(bufs, totalLen), lines: [], dropped };
  }

  const lines = [];
  let lineStartPos = 0;
  let globalPos = 0;
  // Scan bufs sequentially for 0x0a without concatenating
  for (let bi = 0; bi < bufs.length; bi++) {
    const buf = bufs[bi];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        const lineLen = globalPos - lineStartPos;
        if (lineLen > 0) {
          // Extract line bytes from lineStartPos..globalPos-1 across bufs
          if (lineLen <= buf.length && lineStartPos >= globalPos - i) {
            // Line fully inside current buf — zero-copy slice
            const startInBuf = i - lineLen;
            lines.push(buf.subarray(startInBuf, i));
          } else {
            const parts = [];
            let curPos = lineStartPos;
            let pos = 0;
            for (const b of bufs) {
              const nextPos = pos + b.length;
              if (nextPos <= curPos) { pos = nextPos; continue; }
              if (pos >= curPos + lineLen) break;
              const s = Math.max(0, curPos - pos);
              const e = Math.min(b.length, curPos + lineLen - pos);
              if (e > s) parts.push(b.subarray(s, e));
              pos = nextPos;
            }
            lines.push(parts.length === 1 ? parts[0] : Buffer.concat(parts, lineLen));
          }
        }
        lineStartPos = globalPos + 1;
      }
      globalPos++;
    }
  }
  const pendingRemLen = totalLen - lineStartPos;
  let dropped = false;
  if (pendingRemLen > maxPendingBytes) {
    dropped = true;
    const empty = isObjectPending ? { bufs: [], len: 0 } : Buffer.alloc(0);
    return { pending: empty, lines, dropped };
  }
  if (pendingRemLen === 0) {
    const empty = isObjectPending ? { bufs: [], len: 0 } : Buffer.alloc(0);
    return { pending: empty, lines, dropped };
  }
  // Build pending remainder — keep as list of slices (no copy) so fragmented
  // large lines (8MB without newline) do not trigger O(n²) Buffer.concat per chunk.
  if (isObjectPending) {
    const tailParts = [];
    let pos = 0;
    for (const b of bufs) {
      const nextPos = pos + b.length;
      if (nextPos <= lineStartPos) { pos = nextPos; continue; }
      if (pos >= totalLen) break;
      const s = Math.max(0, lineStartPos - pos);
      tailParts.push(b.subarray(s));
      pos = nextPos;
    }
    return { pending: { bufs: tailParts, len: pendingRemLen }, lines, dropped };
  }
  // Legacy Buffer path — extract tail as Buffer
  // Fast path when pending was single buffer and lineStartPos inside it
  if (bufs.length === 1) {
    return { pending: bufs[0].subarray(lineStartPos), lines, dropped };
  }
  const all = Buffer.concat(bufs, totalLen);
  // Make a copy of the tail so the large `all` buffer can be GC'd
  const tailSlice = all.subarray(lineStartPos);
  return { pending: Buffer.from(tailSlice), lines, dropped };
}

/** Attach stdout/close listeners to the current backend process. */
function _ensureListeners() {
  const proc = getProcess();
  if (!proc) return false;
  if (_attachedProcess === proc) return true;

  _attachedProcess = proc;
  let pending = { bufs: [], len: 0 };

  // Cap pending at 68 MiB to avoid unbounded growth.
  const MAX_STDOUT_PENDING_BYTES = 64 * 1024 * 1024 + 4 * 1024 * 1024;

  proc.stdout.on('data', (data) => {
    const framed = _consumeStdoutLines(pending, data, MAX_STDOUT_PENDING_BYTES);
    pending = framed.pending;
    if (framed.dropped) {
      console.error('[ipc-router] dropped oversized stdout line (>68 MiB partial); backend framing is corrupted');
      for (const [id, entry] of _pendingRequests) {
        if (entry.proc !== proc) continue;
        clearTimeout(entry.timeout);
        _pendingRequests.delete(id);
        const err = new Error('IPC framing corrupted: oversized line dropped');
        err.code = -32006;
        err.category = 'FRAMING_CORRUPTED';
        entry.reject(err);
        entry.releasePending();
      }
    }
    for (const lineBuf of framed.lines) {
      const line = lineBuf.toString('utf8');
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Notification (no `id`): forward to renderer
        if (msg.method && msg.params !== undefined && msg.id === undefined) {
          // Track job liveness so health checks don't restart mid-job.
          if (
            msg.method === 'process.progress'
            || msg.method === 'process.heartbeat'
            || (typeof msg.method === 'string' && /^job\..+\.(progress|heartbeat)$/.test(msg.method))
          ) {
            noteJobActivity();
          } else if (
            msg.method === 'process.complete'
            || (typeof msg.method === 'string' && /^job\..+\.complete$/.test(msg.method))
          ) {
            clearJobActivity();
          }
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('ipc-notify', msg.method, msg.params);
          continue;
        }
        // Response to a pending request
        if (msg.id !== undefined && _pendingRequests.has(String(msg.id))) {
          const entry = _pendingRequests.get(String(msg.id));
          clearTimeout(entry.timeout);
          _pendingRequests.delete(String(msg.id));
          entry.releasePending();
          if (typeof entry.responseBytes !== 'number' || entry.responseBytes === 0) {

            entry.responseBytes = lineBuf.byteLength;
          }
          if (msg.error) {
            const errMsg = typeof msg.error === 'object' ? (msg.error.message || JSON.stringify(msg.error)) : String(msg.error);
            const err = new Error(errMsg);
            if (typeof msg.error === 'object') {
              if (msg.error.code !== undefined) err.code = msg.error.code;
              if (msg.error.category !== undefined) err.category = msg.error.category;
              if (msg.error.details !== undefined) err.details = msg.error.details;
            }
            entry.reject(err);
          } else {

            if (entry.method === 'process_start' && msg.result && msg.result.started) {
              noteJobActivity();
            }
            entry.resolve(msg.result);
          }
        }
      } catch { /* malformed line — ignore */ }
    }
  });

  proc.once('exit', () => _handleBackendTermination(proc));
  proc.once('close', () => _handleBackendTermination(proc));

  return true;
}

function _getTimeoutForMethod(method) {
  if (!_getLongRunningMethods().has(method)) return REQUEST_TIMEOUT_MS;
  if (_getHeavyMethods().has(method)) return LONG_REQUEST_TIMEOUT_MS_HEAVY;
  return LONG_REQUEST_TIMEOUT_MS;
}

function _getPendingRequestLimits() {
  return { maxPendingRequests: MAX_PENDING_REQUESTS, maxPendingPerMethod: MAX_PENDING_PER_METHOD };
}

function _capacityError(reason, pending, limit) {
  const err = new Error('IPC pending request capacity exceeded');
  err.code = -32005;
  err.category = 'CAPACITY_EXCEEDED';
  err.details = { retryable: true, reason, pending, limit };
  return err;
}

function _reservePendingRequest(method) {
  if (_pendingRequestCount >= MAX_PENDING_REQUESTS) {
    return { error: _capacityError('ipc_total_pending_limit', _pendingRequestCount, MAX_PENDING_REQUESTS) };
  }
  const methodPending = _pendingMethodCounts.get(method) || 0;
  if (methodPending >= MAX_PENDING_PER_METHOD) {
    return { error: _capacityError('ipc_method_pending_limit', methodPending, MAX_PENDING_PER_METHOD) };
  }

  _pendingRequestCount += 1;
  _pendingMethodCounts.set(method, methodPending + 1);
  return {
    release: () => {
      _pendingRequestCount -= 1;
      const current = _pendingMethodCounts.get(method) || 0;
      if (current <= 1) _pendingMethodCounts.delete(method);
      else _pendingMethodCounts.set(method, current - 1);
    },
  };
}

function _ipcTelemetryVerbose() {
  const raw = String(process.env.ANTARES_IPC_TELEMETRY || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function _estimateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}


function _logIpcTelemetry({
  method,
  requestId = null,
  elapsedMs,
  requestBytes = 0,
  responseBytes = 0,
  outcome = 'ok',
  waitedForDrain = false,
}) {
  const slow = elapsedMs >= IPC_TELEMETRY_SLOW_MS;
  const large = requestBytes >= IPC_TELEMETRY_LARGE_BYTES || responseBytes >= IPC_TELEMETRY_LARGE_BYTES;
  const normalizedOutcome = outcome === 'ok' ? 'success' : outcome === 'error' ? 'failed' : outcome;
  if (!_ipcTelemetryVerbose() && !slow && !large && !waitedForDrain && normalizedOutcome !== 'rejected') return;

  const safeRequestId = requestId === null || requestId === undefined
    ? ''
    : String(requestId).replace(/[^a-zA-Z0-9_.:@-]/g, '_').slice(0, 160);
  const line = `[ipc-router] method=${method} elapsed_ms=${Math.round(elapsedMs)} ` +
    `request_id=${safeRequestId || '-'} request_bytes=${requestBytes} ` +
    `response_bytes=${responseBytes} outcome=${normalizedOutcome}` +
    (waitedForDrain ? ' backpressure=1' : '');
  appendLogEvent(
    normalizedOutcome === 'success' && !slow && !large && !waitedForDrain ? 'INFO' : 'WARN',
    'ipc.request',
    {
      request_id: safeRequestId || undefined,
      method,
      outcome: normalizedOutcome,
      duration_ms: elapsedMs,
      bytes: requestBytes + responseBytes,
      reason: waitedForDrain ? 'backpressure' : undefined,
    },
  );
  if (slow || large || waitedForDrain || normalizedOutcome !== 'success') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function getIpcBackpressureWaits() {
  return _ipcBackpressureWaits;
}

function resetIpcBackpressureWaits() {
  _ipcBackpressureWaits = 0;
}

/** Write JSON-RPC line to stdin; wait for drain if buffer full. */
function _writeStdinWithBackpressure(proc, payload) {
  return new Promise((resolve, reject) => {
    if (!proc || !proc.stdin || typeof proc.stdin.write !== 'function') {
      reject(new Error('Backend stdin is not writable'));
      return;
    }
    let settled = false;
    let onDrain = null;
    let onError = null;
    const finish = (waitedForDrain) => {
      if (settled) return;
      settled = true;
      if (onDrain) proc.stdin.removeListener('drain', onDrain);
      if (onError) proc.stdin.removeListener('error', onError);
      resolve({ waitedForDrain: !!waitedForDrain });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (onDrain) proc.stdin.removeListener('drain', onDrain);
      if (onError) proc.stdin.removeListener('error', onError);
      reject(err);
    };

    let ok;
    try {
      ok = proc.stdin.write(payload);
    } catch (err) {
      fail(err);
      return;
    }

    if (ok !== false) {
      finish(false);
      return;
    }

    _ipcBackpressureWaits += 1;
    onDrain = () => finish(true);
    onError = (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    };
    proc.stdin.once('drain', onDrain);
    proc.stdin.once('error', onError);
  });
}

function _sendRequest(method, params) {
  const proc = getProcess();
  if (!proc || proc.killed) {
    return Promise.reject(new Error('Backend process not available'));
  }


  const id = crypto.randomUUID();
  const request = { jsonrpc: '2.0', id, method, params };
  const line = `${JSON.stringify(request)}\n`;
  const requestBytes = Buffer.byteLength(line, 'utf8');
  const timeoutMs = _getTimeoutForMethod(method);
  const startedAt = Date.now();
  const reservation = _reservePendingRequest(method);
  if (reservation.error) {
    _logIpcTelemetry({
      method,
      elapsedMs: Date.now() - startedAt,
      requestBytes,
      outcome: 'rejected',
    });
    return Promise.reject(reservation.error);
  }

  _ensureListeners();

  incrementPendingRequests();

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const entry = {
      method,
      proc,
      responseBytes: 0,
      waitedForDrain: false,
      pendingReleased: false,
      timeout: null,
      releasePending: () => {
        if (entry.pendingReleased) return;
        entry.pendingReleased = true;
        reservation.release();
        decrementPendingRequests();
      },
      resolve: (result) => {
        const outcome = result && typeof result === 'object' && result.started === false
          ? 'rejected'
          : 'success';
        _logIpcTelemetry({
          method,
          requestId: id,
          elapsedMs: Date.now() - startedAt,
          requestBytes,
          responseBytes: entry.responseBytes || 0,
          outcome,
          waitedForDrain: entry.waitedForDrain,
        });
        settle(resolve, result);
      },
      reject: (err) => {
        const outcome = err && err.message && /timeout/i.test(err.message) ? 'timeout' : 'error';
        _logIpcTelemetry({
          method,
          requestId: id,
          elapsedMs: Date.now() - startedAt,
          requestBytes,
          responseBytes: entry.responseBytes || 0,
          outcome,
          waitedForDrain: entry.waitedForDrain,
        });
        settle(reject, err);
      },
    };

    entry.timeout = setTimeout(() => {
      _pendingRequests.delete(id);
      entry.releasePending();
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ipc-notify', 'ipc.error', {
          method,
          message: `IPC timeout: el backend no respondió a "${method}" en ${timeoutMs / 1000}s`,
        });
      }
      entry.reject(new Error(`IPC timeout: ${method}`));
    }, timeoutMs);

    _pendingRequests.set(id, entry);

    _writeStdinWithBackpressure(proc, line).then((writeResult) => {
      entry.waitedForDrain = !!(writeResult && writeResult.waitedForDrain);
    }).catch((err) => {
      clearTimeout(entry.timeout);
      _pendingRequests.delete(id);
      entry.releasePending();
      entry.reject(new Error(`Backend stdin write failed: ${err.message}`));
    });
  });
}


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


async function _callBackend(method, params) {
    // 1. Wait for ready (or fatal). This is the ONLY place we block for boot.
    if (!isReady()) {
      if (getState() === STATE.FATAL) throw _buildUnavailableError();
      const ready = await waitForReady(STARTUP_WAIT_MS);
      if (!ready) throw _buildUnavailableError();
    }

    // 2. Send, retrying on transient mid-flight failures — idempotent methods only.
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
        if (!transient || !_isIdempotentMethod(method) || attempt === MID_FLIGHT_RETRIES) {
          throw err;
        }

        console.warn(`[ipc-router] "${method}" transient failure (attempt ${attempt + 1}/${MID_FLIGHT_RETRIES + 1}): ${msg}. Waiting for backend...`);
        const ready = await waitForReady(STARTUP_WAIT_MS);
        if (!ready) throw _buildUnavailableError();
      }
    }
    throw lastErr || _buildUnavailableError();
}

function _maybeTokenizeResultPaths(method, result, win) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (typeof result.result_path !== 'string') return result;
  const { createFileCapability } = require('./file-capabilities');
  const webContentsId = win && win.webContents ? win.webContents.id : null;
  const defaultName = typeof result.filename === 'string' && result.filename.trim()
    ? result.filename.trim()
    : method === 'spreadsheet_parse'
      ? 'spreadsheet-result.json'
      : 'result-file';
  const cap = createFileCapability({
    filePath: result.result_path,
    mode: 'read',
    webContentsId,
    name: defaultName,
  });
  const next = { ...result, result_file_token: cap.token };
  delete next.result_path;
  return next;
}

/** Prefix dispatch for native IPC handlers. */
const _DIALOG_NATIVE_METHODS = new Set(
  require('./ipc-methods').NATIVE_METHODS.filter((m) => !m.startsWith('dialog_'))
);
function _dispatchNative(method) {
  if (method.startsWith('dialog_') || _DIALOG_NATIVE_METHODS.has(method)) return 'dialog';
  if (method.startsWith('autoimg_')) return 'autoimg';
  if (method.startsWith('ubicaciones_keys_')) return 'ubicaciones';
  return null;
}

/**
 * Resolve map provider API keys (cached inside ubicaciones-secure-keys;
 * cache clears on ubicaciones_keys_set so mid-session key changes apply).
 */
function _resolveCachedApiKey(provider, fallbackFromRenderer) {
  const { resolveProviderApiKey } = require('./ubicaciones-secure-keys');
  return resolveProviderApiKey(provider, fallbackFromRenderer);
}

function registerIpcHandlers() {
  // Pick up the latest allowlist once at registration. In dev this replaces
  // the per-call cache bust that previously ran on every ipc-call.
  let isPackaged = false;
  try {
    isPackaged = require('electron').app.isPackaged;
  } catch {
    /* tests */
  }
  if (!isPackaged) reloadIpcMethods();

  ipcMain.handle('ipc-call', async (event, method, params) => {
    if (!_isAllowedIpcSender(event)) {
      throw new Error('IPC call rejected: untrusted sender frame');
    }
    if (typeof method !== 'string' || !_getAllowedMethods().has(method)) {
      const hint = ' Reinicia Antares por completo (cierra todas las ventanas) para recargar la allowlist IPC.';
      throw new Error(`IPC method not allowed: ${method}.${hint}`);
    }

    const stagedTokens = _collectStagedTokens(method, params);
    try {
      const win = getMainWindow();
      const { BrowserWindow, session, nativeImage } = require('electron');
      const nativeHandler = _dispatchNative(method);
      if (nativeHandler) {
        const result = nativeHandler === 'dialog'
          ? await handleDialogCall(method, params, dialog, win, { BrowserWindow, session, nativeImage })
          : nativeHandler === 'autoimg'
            ? await (async () => {
              const { handleAutoimgCall } = require('./autoimg-handlers');
              return handleAutoimgCall(method, params);
            })()
            : await (async () => {
              const { handleUbicacionesCall } = require('./ubicaciones-handlers');
              return handleUbicacionesCall(method, params);
            })();
        if (result.handled) return result.result;
      }
      let backendParams = _maybeResolveFileTokens(params, win, method);
      backendParams = _validateAndResolveWriteParams(backendParams, win, method);

      if (method === 'preview_ubicacion' || method === 'generar_ubicaciones') {
        const provider = backendParams && typeof backendParams === 'object' ? backendParams.provider : '';
        const fallback = backendParams?.api_key;
        const injected = _resolveCachedApiKey(provider, fallback);
        backendParams = { ...backendParams, api_key: injected };
      }

      try {
        const result = await _callBackend(method, backendParams);
        return _maybeTokenizeResultPaths(method, result, win);
      } catch (err) {

        throw _toRendererIpcError(err);
      }
    } finally {
      await _cleanupStagedTokens(stagedTokens, event?.sender?.id ?? null);
    }
  });

  ipcMain.handle('backend-status', async (event) => {
    if (!_isAllowedIpcSender(event)) {
      throw new Error('IPC call rejected: untrusted sender frame');
    }
    let isPackaged = false;
    try {
      isPackaged = require('electron').app.isPackaged;
    } catch {
      /* tests */
    }
    return {
      state: getState(),
      ready: isReady(),
      lastError: getLastError(),
      health: getHealthStatus(),
      stderrTail: isPackaged ? '' : getStderrTail(),
    };
  });

  ipcMain.handle('backend-restart', async (event) => {
    if (!_isAllowedIpcSender(event)) {
      throw new Error('IPC call rejected: untrusted sender frame');
    }
    const now = Date.now();
    if (now - _lastBackendRestartAt < BACKEND_RESTART_MIN_INTERVAL_MS) {
      return { success: false, state: getState(), error: 'rate_limited' };
    }

    const win = getMainWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Reiniciar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Reiniciar backend',
      message: '¿Reiniciar el servicio de Antares?',
      detail: 'Las operaciones en curso pueden interrumpirse.',
    });
    if (response !== 0) {
      return { success: false, state: getState(), cancelled: true };
    }

    _lastBackendRestartAt = now;
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

  ipcMain.handle('window-control', async (event, action) => {
    if (!_isAllowedIpcSender(event)) {
      throw new Error('IPC call rejected: untrusted sender frame');
    }
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { handled: false };
    if (action === 'minimize') { win.minimize(); return { handled: true }; }
    if (action === 'maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); return { handled: true, maximized: win.isMaximized() }; }
    if (action === 'close') { win.close(); return { handled: true }; }
    return { handled: false };
  });

  ipcMain.handle('app-menu-popup', async (event, menuIndex, position) => {
    if (!_isAllowedIpcSender(event)) {
      throw new Error('IPC call rejected: untrusted sender frame');
    }
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

module.exports = {
  registerIpcHandlers,
  _ensureListeners,
  _consumeStdoutLines,
  _maybeResolveFileTokens,
  _collectStagedTokens,
  _cleanupStagedTokens,
  _validateAndResolveWriteParams,
  _isAllowedIpcSender,
  _sendRequest,
  _callBackend,
  _isIdempotentMethod,
  _DIALOG_NATIVE_METHODS,
  _toRendererIpcError,
  _writeStdinWithBackpressure,
  MAX_PENDING_REQUESTS,
  MAX_PENDING_PER_METHOD,
  DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_MAX_PENDING_PER_METHOD,
  _getPendingRequestLimits,
  _logIpcTelemetry,
  _estimateJsonBytes,
  _maybeTokenizeResultPaths,
  getIpcBackpressureWaits,
  resetIpcBackpressureWaits,
  ANTARES_IPC_ERROR_PREFIX,
  reloadIpcMethods,
};
