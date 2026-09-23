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
const { getMainWindow } = require('./window-manager');
const { appendLogEvent } = require('./app-log');
const { isTrustedRendererFrame } = require('./renderer-trust');
const {
  _maybeResolveFileTokens,
  _validateAndResolveWriteParams,
} = require('./ipc-file-policy');

const _pendingRequests = new Map();
const _pendingMethodCounts = new Map();
let _pendingRequestCount = 0;
let _attachedProcess = null;

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
    '../shared/ipc-method-catalog',
    '../shared/ipc-method-catalog.json',
  ];
  for (const rel of modules) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch {
    }
  }
  _ipcMethodsCache = null;
  return _loadIpcMethods();
}

function _getAllowedMethods() {
  return _loadIpcMethods().ALLOWED_RENDERER_METHODS;
}

function _ipcCatalog() {
  return require('../shared/ipc-method-catalog');
}

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

let _ipcBackpressureWaits = 0;
const ANTARES_IPC_ERROR_PREFIX = 'ANTARES_IPC_ERROR:';

function _toRendererIpcError(err) {
  const payload = {
    message: err && err.message ? String(err.message) : String(err),
    code: err && err.code !== undefined ? err.code : -32000,
    category: err && err.category !== undefined ? err.category : 'INTERNAL_ERROR',
    details: err && err.details !== undefined ? err.details : undefined,
    request_id: err && typeof err.ipc_request_id === 'string' ? err.ipc_request_id : undefined,
  };
  return new Error(ANTARES_IPC_ERROR_PREFIX + JSON.stringify(payload));
}

function _isIdempotentMethod(method) {
  return _ipcCatalog().isIdempotent(method);
}

let _lastBackendRestartAt = 0;

function _resolveIsDev() {
  try {
    return require('./window-manager').getIsDev();
  } catch {}
  try {
    return !require('electron').app.isPackaged;
  } catch {}
  return false;
}

function _isAllowedIpcSender(event) {
  return isTrustedRendererFrame(event, getMainWindow(), _resolveIsDev());
}

function _logSecurityRejection(reason, method, message) {
  appendLogEvent('WARN', 'security.rejected', {
    component: 'electron',
    outcome: 'rejected',
    reason,
    method: typeof method === 'string' && method ? method : undefined,
    message,
  });
}

function _handleBackendTermination(proc) {
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

function _consumeStdoutLines(pending, chunk, maxPendingBytes = Infinity) {
  const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const bufs = pending.bufs;
  const totalLen = pending.len + piece.length;
  bufs.push(piece);

  if (piece.indexOf(0x0a) === -1) {
    if (totalLen > maxPendingBytes) {
      return { pending: { bufs: [], len: 0 }, lines: [], dropped: true };
    }
    return { pending: { bufs, len: totalLen }, lines: [], dropped: false };
  }

  const lines = [];
  let lineStartPos = 0;
  let globalPos = 0;
  for (const buf of bufs) {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        const lineLen = globalPos - lineStartPos;
        if (lineLen > 0) {
          if (lineLen <= buf.length && lineStartPos >= globalPos - i) {
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
  if (pendingRemLen > maxPendingBytes) {
    return { pending: { bufs: [], len: 0 }, lines, dropped: true };
  }
  if (pendingRemLen === 0) {
    return { pending: { bufs: [], len: 0 }, lines, dropped: false };
  }
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
  return { pending: { bufs: tailParts, len: pendingRemLen }, lines, dropped: false };
}

function _ensureListeners() {
  const proc = getProcess();
  if (!proc) return false;
  if (_attachedProcess === proc) return true;

  _attachedProcess = proc;
  let pending = { bufs: [], len: 0 };

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
        if (msg.method && msg.params !== undefined && msg.id === undefined) {
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
      } catch (err) {
        appendLogEvent('WARN', 'ipc.stdout_parse', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  proc.once('exit', () => _handleBackendTermination(proc));
  proc.once('close', () => _handleBackendTermination(proc));

  return true;
}

function _getTimeoutForMethod(method) {
  return _ipcCatalog().timeoutMsFor(method);
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

function _estimateStringJsonBytes(value) {
  let bytes = Buffer.byteLength(value, 'utf8') + 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 1;
    else if (code < 0x20) bytes += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 1 : 5;
  }
  return bytes;
}

function _estimatePayloadBytes(value) {
  const ancestors = new Set();
  const estimate = (entry, inArray = false) => {
    if (entry === null) return 4;
    if (typeof entry === 'string') return _estimateStringJsonBytes(entry);
    if (typeof entry === 'number') return Number.isFinite(entry) ? Buffer.byteLength(String(entry), 'utf8') : 4;
    if (typeof entry === 'boolean') return entry ? 4 : 5;
    if (typeof entry === 'undefined' || typeof entry === 'function' || typeof entry === 'symbol') return inArray ? 4 : 0;
    if (typeof entry === 'bigint') throw new TypeError('BigInt is not JSON serializable');
    if (Buffer.isBuffer(entry) || ArrayBuffer.isView(entry)) return entry.byteLength;
    if (entry instanceof ArrayBuffer) return entry.byteLength;
    if (typeof Blob !== 'undefined' && entry instanceof Blob) return entry.size;
    if (ancestors.has(entry)) throw new TypeError('Circular payload');

    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) {
        let bytes = 2;
        for (let index = 0; index < entry.length; index += 1) {
          if (index > 0) bytes += 1;
          bytes += estimate(entry[index], true);
        }
        return bytes;
      }

      let bytes = 2;
      let first = true;
      for (const key in entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
        const child = entry[key];
        if (typeof child === 'undefined' || typeof child === 'function' || typeof child === 'symbol') continue;
        if (!first) bytes += 1;
        first = false;
        bytes += _estimateStringJsonBytes(key) + 1 + estimate(child);
      }
      return bytes;
    } finally {
      ancestors.delete(entry);
    }
  };

  try {
    return estimate(value);
  } catch {
    return 0;
  }
}

function _ipcErrorCode(err) {
  if (!err || typeof err !== 'object') return undefined;
  if (typeof err.category === 'string' && err.category) return err.category;
  if (err.code !== undefined && err.code !== null) return String(err.code);
  const msg = typeof err.message === 'string' ? err.message : '';
  if (/timeout/i.test(msg)) return 'IPC_TIMEOUT';
  if (msg.includes('Backend process exited')) return 'BACKEND_EXITED';
  if (msg.includes('stdin write failed')) return 'BACKEND_STDIN_WRITE_FAILED';
  if (msg.includes('not available')) return 'BACKEND_UNAVAILABLE';
  return undefined;
}

function _logIpcTelemetry({
  method,
  requestId = null,
  elapsedMs,
  requestBytes = 0,
  responseBytes = 0,
  outcome = 'ok',
  waitedForDrain = false,
  errorCode,
  reason,
}) {
  const slow = elapsedMs >= IPC_TELEMETRY_SLOW_MS;
  const large = requestBytes >= IPC_TELEMETRY_LARGE_BYTES || responseBytes >= IPC_TELEMETRY_LARGE_BYTES;
  const normalizedOutcome = outcome === 'ok' ? 'success' : outcome === 'error' ? 'failed' : outcome;
  const baselineSample = normalizedOutcome === 'success'
    && ((elapsedMs ^ Math.imul(requestBytes + responseBytes, 2654435761)) >>> 0) % 100 === 0;
  if (normalizedOutcome === 'success' && !_ipcTelemetryVerbose() && !slow && !large && !waitedForDrain && !baselineSample) return;

  const safeRequestId = requestId === null || requestId === undefined
    ? ''
    : String(requestId).replace(/[^a-zA-Z0-9_.:@-]/g, '_').slice(0, 160);
  const line = `[ipc-router] method=${method} elapsed_ms=${Math.round(elapsedMs)} ` +
    `request_id=${safeRequestId || '-'} request_bytes=${requestBytes} ` +
    `response_bytes=${responseBytes} outcome=${normalizedOutcome}` +
    (waitedForDrain ? ' backpressure=1' : '');
  appendLogEvent(
    normalizedOutcome === 'failed' || normalizedOutcome === 'timeout'
      ? 'ERROR'
      : normalizedOutcome === 'success' && !slow && !large && !waitedForDrain
        ? 'INFO'
        : 'WARN',
    'ipc.request',
    {
      request_id: safeRequestId || undefined,
      method,
      outcome: normalizedOutcome,
      duration_ms: elapsedMs,
      bytes: requestBytes + responseBytes,
      error_code: errorCode || undefined,
      reason: reason || (waitedForDrain ? 'backpressure' : undefined),
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
    try { reservation.error.ipc_request_id = id; } catch {}
    _logIpcTelemetry({
      method,
      requestId: id,
      elapsedMs: Date.now() - startedAt,
      requestBytes,
      outcome: 'rejected',
      errorCode: _ipcErrorCode(reservation.error),
      reason: reservation.error && reservation.error.details && reservation.error.details.reason,
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
          reason: outcome === 'rejected' && result && typeof result === 'object' ? result.reason : undefined,
        });
        settle(resolve, result);
      },
      reject: (err) => {
        const outcome = err && err.message && /timeout/i.test(err.message) ? 'timeout' : 'error';
        if (err && typeof err === 'object') {
          try { err.ipc_request_id = id; } catch {}
        }
        _logIpcTelemetry({
          method,
          requestId: id,
          elapsedMs: Date.now() - startedAt,
          requestBytes,
          responseBytes: entry.responseBytes || 0,
          outcome,
          waitedForDrain: entry.waitedForDrain,
          errorCode: _ipcErrorCode(err),
        });
        settle(reject, err);
      },
    };

    entry.timeout = setTimeout(() => {
      _pendingRequests.delete(id);
      entry.releasePending();
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

function _isTransientBackendError(err) {
  const msg = err.message || '';
  return msg.includes('Backend process exited')
    || msg.includes('Backend process not available')
    || msg.includes('stdin write failed');
}

async function _callBackend(method, params) {
    if (!isReady()) {
      if (getState() === STATE.FATAL) throw _buildUnavailableError();
      const ready = await waitForReady(STARTUP_WAIT_MS);
      if (!ready) throw _buildUnavailableError();
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= MID_FLIGHT_RETRIES; attempt++) {
      try {
        _ensureListeners();
        return await _sendRequest(method, params);
      } catch (err) {
        lastErr = err;
        if (!_isTransientBackendError(err) || !_isIdempotentMethod(method) || attempt === MID_FLIGHT_RETRIES) {
          throw err;
        }
        const msg = err.message || '';

        appendLogEvent('WARN', 'ipc.retry', {
          component: 'electron',
          method,
          attempt: attempt + 1,
          reason: 'transient_error',
          outcome: 'degraded',
          request_id: err && err.ipc_request_id ? err.ipc_request_id : undefined,
          error_code: _ipcErrorCode(err),
        });
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

const _NATIVE_CALLS = {
  dialog: (method, params, win, electron) => handleDialogCall(method, params, dialog, win, electron),
  autoimg: (method, params) => {
    const { handleAutoimgCall } = require('./autoimg-handlers');
    return handleAutoimgCall(method, params);
  },
  ubicaciones: (method, params) => {
    const { handleUbicacionesCall } = require('./ubicaciones-handlers');
    return handleUbicacionesCall(method, params);
  },
};

function _resolveCachedApiKey(provider) {
  const { resolveProviderApiKey } = require('./ubicaciones-secure-keys');
  return resolveProviderApiKey(provider);
}

function _isPackaged() {
  try {
    return !!require('electron').app.isPackaged;
  } catch {
    return false;
  }
}

function _requireTrustedSender(event, method) {
  if (!_isAllowedIpcSender(event)) {
    _logSecurityRejection('untrusted_sender', method);
    throw new Error('IPC call rejected: untrusted sender frame');
  }
}

function _tagValidationError(err, method) {
  if (err && typeof err === 'object' && err.category === undefined) {
    err.code = -32602;
    err.category = 'VALIDATION_ERROR';
  }
  _logSecurityRejection('file_policy', method, err && err.message ? err.message : undefined);
}

function registerIpcHandlers() {
  if (!_isPackaged()) reloadIpcMethods();

  ipcMain.handle('ipc-call', async (event, method, params) => {
    _requireTrustedSender(event, typeof method === 'string' ? method : undefined);
    if (typeof method !== 'string' || !_getAllowedMethods().has(method)) {
      _logSecurityRejection('method_not_allowed', typeof method === 'string' ? method : undefined);
      const hint = ' Reinicia Antares por completo (cierra todas las ventanas) para recargar la allowlist IPC.';
      throw new Error(`IPC method not allowed: ${method}.${hint}`);
    }

    const win = getMainWindow();
    const { BrowserWindow, session, nativeImage } = require('electron');
    try {
      const nativeHandler = _ipcCatalog().nativeDispatchFor(method);
      if (nativeHandler) {
        let nativeParams = params;
        const startedAt = Date.now();
        const requestBytes = _estimatePayloadBytes(params);
        try {
          const { _assertNoRawAbsolutePaths } = require('./file-capabilities');
          const catalog = _ipcCatalog();
          _assertNoRawAbsolutePaths(nativeParams, {
            allowRegisteredReadPaths: true,
            allowRawAbsolutePathKeys: catalog.RAW_OUTPUT_PATH_METHODS.has(method)
              ? new Set(['path'])
              : undefined,
            writePathKeys: catalog.METHOD_OUTPUT_PATH_KEYS.get(method),
          });
          nativeParams = _validateAndResolveWriteParams(nativeParams, win, method);
        } catch (err) {
          _tagValidationError(err, method);
          _logIpcTelemetry({
            method,
            elapsedMs: Date.now() - startedAt,
            requestBytes,
            responseBytes: 0,
            outcome: 'rejected',
            errorCode: _ipcErrorCode(err),
          });
          throw err;
        }
        const nativeCall = _NATIVE_CALLS[nativeHandler];
        try {
          const result = await nativeCall(method, nativeParams, win, { BrowserWindow, session, nativeImage });
          if (result && result.handled) {
            const responseBytes = _estimatePayloadBytes(result.result);
            _logIpcTelemetry({
              method,
              elapsedMs: Date.now() - startedAt,
              requestBytes,
              responseBytes,
              outcome: 'success',
            });
            return result.result;
          }
        } catch (err) {
          _logIpcTelemetry({
            method,
            elapsedMs: Date.now() - startedAt,
            requestBytes,
            responseBytes: 0,
            outcome: 'error',
            errorCode: _ipcErrorCode(err),
          });
          throw err;
        }
      }
    } catch (err) {
      throw _toRendererIpcError(err);
    }
    let backendParams;
    try {
      backendParams = _maybeResolveFileTokens(params, win, method);
      backendParams = _validateAndResolveWriteParams(backendParams, win, method);
    } catch (err) {
      _tagValidationError(err, method);
      _logIpcTelemetry({ method, elapsedMs: 0, requestBytes: _estimatePayloadBytes(params), outcome: 'rejected', errorCode: _ipcErrorCode(err) });
      throw _toRendererIpcError(err);
    }

    if (method === 'preview_ubicacion' || method === 'generar_ubicaciones') {
      const provider = backendParams && typeof backendParams === 'object' ? backendParams.provider : '';
      const injected = _resolveCachedApiKey(provider);
      backendParams = { ...backendParams, api_key: injected };
    }

    try {
      const result = await _callBackend(method, backendParams);
      return _maybeTokenizeResultPaths(method, result, win);
    } catch (err) {
      throw _toRendererIpcError(err);
    }
  });

  ipcMain.handle('backend-status', async (event) => {
    _requireTrustedSender(event, 'backend-status');
    const isPackaged = _isPackaged();
    return {
      state: getState(),
      ready: isReady(),
      lastError: getLastError(),
      health: getHealthStatus(),
      stderrTail: isPackaged ? '' : getStderrTail(),
    };
  });

  ipcMain.handle('backend-restart', async (event) => {
    _requireTrustedSender(event, 'backend-restart');
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
    const ok = await manualRestart(_resolveIsDev());
    return { success: ok, state: getState() };
  });

  ipcMain.handle('window-control', async (event, action) => {
    _requireTrustedSender(event, 'window-control');
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { handled: false };
    if (action === 'minimize') { win.minimize(); return { handled: true }; }
    if (action === 'maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); return { handled: true, maximized: win.isMaximized() }; }
    if (action === 'close') { win.close(); return { handled: true }; }
    return { handled: false };
  });
}

module.exports = {
  registerIpcHandlers,
  _ensureListeners,
  _consumeStdoutLines,
  _maybeResolveFileTokens,
  _validateAndResolveWriteParams,
  _isAllowedIpcSender,
  _sendRequest,
  _callBackend,
  _isIdempotentMethod,
  _toRendererIpcError,
  _writeStdinWithBackpressure,
  _getPendingRequestLimits,
  _logIpcTelemetry,
  _estimatePayloadBytes,
  _estimateJsonBytes: _estimatePayloadBytes,
  _maybeTokenizeResultPaths,
  getIpcBackpressureWaits,
  resetIpcBackpressureWaits,
  ANTARES_IPC_ERROR_PREFIX,
};
