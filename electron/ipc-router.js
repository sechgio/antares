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

const _pendingRequests = new Map();
const _pendingMethodCounts = new Map();
let _pendingRequestCount = 0;
let _attachedProcess = null;               // process instance we have listeners on

/**
 * Resolve IPC allowlist (+ long-running set).
 *
 * The module is cached after first load. In dev, `reloadIpcMethods()` busts
 * the cache so edits to `ipc-methods.js` are picked up without a full
 * Electron restart (Vite HMR does not reload main). `registerIpcHandlers`
 * calls it once at registration; per-call hot-reload is unnecessary and was
 * re-requiring 4 modules on every IPC call.
 */
let _ipcMethodsCache = null;

function _loadIpcMethods() {
  if (_ipcMethodsCache) return _ipcMethodsCache;
  _ipcMethodsCache = require('./ipc-methods');
  return _ipcMethodsCache;
}

function reloadIpcMethods() {
  for (const rel of ['./ipc-methods', './autoimg-ipc-methods', './ubicaciones-ipc-methods', '../shared/long-running-methods.json']) {
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

// Budgets
const REQUEST_TIMEOUT_MS = 30_000;         // per-request response timeout — most ops finish in <5s
const LONG_REQUEST_TIMEOUT_MS = 900_000;   // 15 min for heavy operations (large PDF/ZIP batches)
const STARTUP_WAIT_MS = 60_000;            // align with backend-spawner handshake (onedir + AV)
const MID_FLIGHT_RETRIES = 2;              // retries for transient mid-flight errors (idempotent only)
const BACKEND_RESTART_MIN_INTERVAL_MS = 5_000;
// Cheap IPC telemetry: always warn on slow/large calls; full log when ANTARES_IPC_TELEMETRY=1.
const IPC_TELEMETRY_SLOW_MS = 5_000;
const IPC_TELEMETRY_LARGE_BYTES = 1 * 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 128;
const DEFAULT_MAX_PENDING_PER_METHOD = 32;

function _positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
/** Prefix for structured IPC errors embedded in Error.message (Electron only clones message). */
const ANTARES_IPC_ERROR_PREFIX = 'ANTARES_IPC_ERROR:';

/**
 * Encode code/category/details inside Error.message so they survive ipcMain.handle.
 * Plain-object throws are stringified as "[object Object]" by Electron and break the UI.
 */
function _toRendererIpcError(err) {
  const payload = {
    message: err && err.message ? String(err.message) : String(err),
    code: err && err.code !== undefined ? err.code : -32000,
    category: err && err.category !== undefined ? err.category : 'INTERNAL_ERROR',
    details: err && err.details !== undefined ? err.details : undefined,
  };
  return new Error(ANTARES_IPC_ERROR_PREFIX + JSON.stringify(payload));
}

/**
 * Mid-flight retries are only safe for idempotent reads. Mutators
 * (process_start, db_import, canvas_save, …) must not be resent — the dying
 * process may already have accepted the RPC.
 */
function _isIdempotentMethod(method) {
  if (typeof method !== 'string') return false;
  // Explicit safe reads that do not end in get/list/status.
  if (
    method === 'version'
    || method === 'formats'
    || method === 'preview'
    || method === 'is_video'
    || method === 'db_records'
    || method === 'db_columns'
    || method === 'db_fields'
    || method === 'db_template'
    || method === 'db_parse_mapping'
    || method === 'db_validate_mapping'
    || method === 'db_detect_key_column'
    || method === 'theme_presets'
    || method === 'theme_preset'
    || method === 'panel_aviso_corte_template'
    || method.includes('_autocomplete_')
  ) {
    return true;
  }
  return /(?:^|_)(?:get|list|status)$/.test(method);
}

let _lastBackendRestartAt = 0;

function _isAllowedIpcSender(event) {
  const url = event?.senderFrame?.url || '';
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
  if (isDev) {
    return url.startsWith('http://localhost:5173/') || url.startsWith('http://127.0.0.1:5173/');
  }
  return url.startsWith('file://');
}

/**
 * Frame NDJSON lines from stdout without string-concat buffering.
 * Keeps pending bytes as Buffer (UTF-8) so large responses do not inflate to
 * UTF-16 JS strings until each complete line is parsed.
 *
 * `maxPendingBytes` caps a fragmented line (backend allows up to 64 MiB
 * payloads; a pathological oversized/never-terminated line must not keep
 * growing via Buffer.concat). When exceeded, the partial line is dropped and
 * `dropped` is set so the caller can log it.
 *
 * Optimized: pending is stored as {bufs: Buffer[], len: number} in the hot
 * path (_ensureListeners) to avoid Buffer.concat O(n²) per chunk. This
 * function accepts both Buffer (legacy/tests) and {bufs,len} (hot path) and
 * returns the same shape it received, so tests keep passing.
 *
 * @param {Buffer|{bufs: Buffer[], len: number}} pending
 * @param {Buffer|string|Uint8Array} chunk
 * @param {number} [maxPendingBytes]
 * @returns {{ pending: Buffer|{bufs: Buffer[], len: number}, lines: Buffer[], dropped: boolean }}
 */
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

/**
 * Attach stdout/close listeners to the current backend process if we haven't
 * already. Re-runs whenever the backend is restarted.
 */
function _ensureListeners() {
  const proc = getProcess();
  if (!proc) return false;
  if (_attachedProcess === proc) return true;

  _attachedProcess = proc;
  let pending = { bufs: [], len: 0 };

  // Backend caps payloads at 64 MiB; leave headroom for JSON framing so a
  // legitimate max-size line still parses, but a pathological never-ending
  // line cannot grow the pending Buffer without bound.
  const MAX_STDOUT_PENDING_BYTES = 64 * 1024 * 1024 + 4 * 1024 * 1024;

  proc.stdout.on('data', (data) => {
    const framed = _consumeStdoutLines(pending, data, MAX_STDOUT_PENDING_BYTES);
    pending = framed.pending;
    if (framed.dropped) {
      console.error('[ipc-router] dropped oversized stdout line (>68 MiB partial); backend framing is corrupted');
    }
    for (const lineBuf of framed.lines) {
      const line = lineBuf.toString('utf8');
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Notification (no `id`): forward to renderer
        if (msg.method && msg.params !== undefined && msg.id === undefined) {
          // Track conversion/job liveness so health checks do not force-restart
          // the backend while process_start has already returned (no pending IPC).
          // Heartbeats fire while a single file is still converting (no progress yet).
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
            // Prefer framed UTF-8 byte length over re-JSON.stringify(msg).
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
            // Mark job activity as soon as process_start accepts work — before the
            // first Python heartbeat (~15s wait-first). Prevents health-probe
            // force-restarts in the post-start window with pending=0.
            if (entry.method === 'process_start' && msg.result && msg.result.started) {
              noteJobActivity();
            }
            entry.resolve(msg.result);
          }
        }
      } catch { /* malformed line — ignore */ }
    }
  });

  proc.on('close', () => {
    // Always reject requests that were sent on THIS process — even if a newer
    // process already replaced `_attachedProcess`. Skipping that left orphans
    // until the per-method timeout after kill+respawn races.
    for (const [id, entry] of _pendingRequests) {
      if (entry.proc !== proc) continue;
      clearTimeout(entry.timeout);
      _pendingRequests.delete(id);
      entry.reject(new Error('Backend process exited while waiting for response'));
      entry.releasePending();
    }
    // Only detach + clear job activity for the currently attached process.
    if (_attachedProcess !== proc) return;
    _attachedProcess = null;
    clearJobActivity();
  });

  return true;
}

function _getTimeoutForMethod(method) {
  return _getLongRunningMethods().has(method) ? LONG_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
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

/**
 * Log cheap IPC timing/size signals. Verbose mode logs every call; otherwise
 * only slow or large payloads (regression smoke without drowning stderr).
 */
function _logIpcTelemetry({
  method,
  elapsedMs,
  requestBytes = 0,
  responseBytes = 0,
  outcome = 'ok',
  waitedForDrain = false,
}) {
  const slow = elapsedMs >= IPC_TELEMETRY_SLOW_MS;
  const large = requestBytes >= IPC_TELEMETRY_LARGE_BYTES || responseBytes >= IPC_TELEMETRY_LARGE_BYTES;
  if (!_ipcTelemetryVerbose() && !slow && !large && !waitedForDrain && outcome === 'ok') return;

  const line = `[ipc-router] method=${method} elapsed_ms=${Math.round(elapsedMs)} ` +
    `request_bytes=${requestBytes} response_bytes=${responseBytes} outcome=${outcome}` +
    (waitedForDrain ? ' backpressure=1' : '');
  if (slow || large || waitedForDrain || outcome !== 'ok') {
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

/**
 * Write one JSON-RPC line to Python stdin. If the pipe buffer is full
 * (`write` returns false), wait for `drain` before resolving so callers do
 * not pile unbounded serialized payloads onto a stalled child.
 *
 * Note: stubs that return `undefined` are treated as success (only `false`
 * means backpressure), matching Node's Writable contract.
 */
function _writeStdinWithBackpressure(proc, payload) {
  return new Promise((resolve, reject) => {
    if (!proc || !proc.stdin || typeof proc.stdin.write !== 'function') {
      reject(new Error('Backend stdin is not writable'));
      return;
    }
    let settled = false;
    const finish = (waitedForDrain) => {
      if (settled) return;
      settled = true;
      resolve({ waitedForDrain: !!waitedForDrain });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
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
    const onDrain = () => finish(true);
    const onError = (err) => {
      proc.stdin.removeListener('drain', onDrain);
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
        _logIpcTelemetry({
          method,
          elapsedMs: Date.now() - startedAt,
          requestBytes,
          responseBytes: entry.responseBytes || 0,
          outcome: 'ok',
          waitedForDrain: entry.waitedForDrain,
        });
        settle(resolve, result);
      },
      reject: (err) => {
        const outcome = err && err.message && /timeout/i.test(err.message) ? 'timeout' : 'error';
        _logIpcTelemetry({
          method,
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

/**
 * Prefix-based dispatch for native (non-backend) IPC handlers.
 * Returns 'dialog' | 'autoimg' | 'ubicaciones' | null so the router only
 * invokes the single handler that could match, instead of probing all three.
 * The handlers still do their own Set-based authoritative check.
 *
 * Derived from the single native-method allowlist in ipc-methods.js. The
 * dialog_* group is matched by prefix below, so the derived set excludes it
 * — mirroring the historical inline list exactly.
 */
const _DIALOG_NATIVE_METHODS = new Set(
  require('./ipc-methods').NATIVE_METHODS.filter((m) => !m.startsWith('dialog_'))
);
function _dispatchNative(method) {
  if (method.startsWith('dialog_') || _DIALOG_NATIVE_METHODS.has(method)) return 'dialog';
  if (method.startsWith('autoimg_')) return 'autoimg';
  if (method.startsWith('ubicaciones_keys_')) return 'ubicaciones';
  return null;
}

function _maybeResolveFileTokens(params, win) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const { resolveCapability, _assertNoRawAbsolutePaths } = require('./file-capabilities');
  _assertNoRawAbsolutePaths(params);
  const webContentsId = win && win.webContents ? win.webContents.id : null;
  const tokenKeys = ['file_token', 'fileToken', 'excel_file_token', 'excelPath', 'spreadsheet_token', 'result_file_token', 'cache_token'];
  let next = params;
  let mutated = false;
  for (const k of tokenKeys) {
    if (typeof params[k] === 'string' && params[k].startsWith('antares-')) {
      try {
        const cap = resolveCapability(params[k], 'read', webContentsId);
        if (!mutated) { next = { ...params }; mutated = true; }
        next[k] = cap.path;
        if (k === 'file_token' || k === 'result_file_token' || k === 'cache_token') {
          next._resolved_file_token_path = cap.path;
          if (cap.name) next._resolved_file_token_name = cap.name;
        }
      } catch (e) {
        throw new Error(`invalid file token for ${k}: ${e.message}`);
      }
    }
  }
  if (Array.isArray(params.file_tokens)) {
    const resolved = [];
    for (const t of params.file_tokens) {
      if (typeof t === 'string' && t.startsWith('antares-')) {
        const cap = resolveCapability(t, 'read', webContentsId);
        resolved.push(cap.path);
      } else resolved.push(t);
    }
    if (!mutated) { next = { ...params }; mutated = true; }
    next.file_tokens = resolved;
  }
  return next;
}

function _validateAndResolveWriteParams(params, win) {
  if (!params || typeof params !== 'object') return params;
  const needsWrite = 'output_path' in params || 'outputPath' in params || 'output_dir' in params || 'outputDir' in params || 'output_folder' in params || 'outputFolder' in params || (params.path && typeof params.path === 'string' && params.path.includes('/'));
  if (!needsWrite) return params;
  const outRaw = params.output_path || params.outputPath || params.output_dir || params.outputDir || params.output_folder || params.outputFolder || params.path;
  // Token format is `antares-write_<uuid>` (file-capabilities._newToken uses an
  // underscore separator). Match the exact prefix so a legitimate folder named
  // e.g. `antares-write-notes` is not mistaken for a token.
  if (typeof outRaw === 'string' && outRaw.startsWith('antares-write_')) {
    const { resolveCapability } = require('./file-capabilities');
    const webContentsId = win && win.webContents ? win.webContents.id : null;
    try {
      const cap = resolveCapability(outRaw, 'write', webContentsId);
      // Rewrite the raw field the backend reads (outputDir stays a real path
      // for handlers that consume it directly).
      const next = { ...params, _resolved_output_path: cap.path, _write_token: outRaw };
      if ('outputDir' in params) next.outputDir = cap.path;
      if ('output_dir' in params) next.output_dir = cap.path;
      return next;
    } catch (e) {
      throw new Error(`invalid write token: ${e.message}`);
    }
  }
  if (typeof outRaw === 'string' && outRaw.trim()) {
    const path = require('path');
    const fs = require('fs');
    const { isPathInside, isAllowedReadPath } = require('./path-allowlist');
    try {
      const resolved = path.resolve(outRaw);
      const dir = fs.existsSync(resolved)
        ? (fs.lstatSync(resolved).isDirectory() ? resolved : path.dirname(resolved))
        : path.dirname(resolved);
      let allowed = false;
      try {
        const { app } = require('electron');
        for (const name of ['documents', 'downloads']) {
          try {
            const stdRoot = app.getPath(name);
            if (stdRoot && isPathInside(stdRoot, dir)) { allowed = true; break; }
          } catch { /* ignore */ }
        }
      } catch { /* Electron unavailable in unit tests */ }
      if (!allowed) {
        // Folders chosen through native dialogs are registered write roots.
        const { isUnderAllowedWriteRoot } = require('./dialog-handlers');
        if (isUnderAllowedWriteRoot(dir)) allowed = true;
      }
      if (!allowed) {
        if (!isAllowedReadPath(resolved) && !isAllowedReadPath(dir)) {
          throw new Error('La ruta de salida no está permitida. Usa el diálogo de guardado.');
        }
      }
      const real = fs.realpathSync(dir);
      if (real !== dir) throw new Error('symlink no permitido en ruta de salida');
    } catch (e) {
      if (e.message.includes('no está permitida') || e.message.includes('symlink')) throw e;
      throw new Error(`ruta de salida no permitida: ${e.message}`);
    }
  }
  return params;
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

    // Dialog / native methods are handled in Electron main without touching Python.
    // Prefix-based dispatch avoids three sequential probes per non-native call.
    const win = getMainWindow();
    const { BrowserWindow, session, nativeImage } = require('electron');
    const nativeHandler = _dispatchNative(method);
    if (nativeHandler) {
      const result = nativeHandler === 'dialog'
        ? await handleDialogCall(method, params, dialog, win, { BrowserWindow, session, nativeImage })
        : nativeHandler === 'autoimg'
          ? await (async () => {
            // Lazy: autoimg sync-engine + Google clients are heavy; only load on first use.
            const { handleAutoimgCall } = require('./autoimg-handlers');
            return handleAutoimgCall(method, params);
          })()
          : await (async () => {
            const { handleUbicacionesCall } = require('./ubicaciones-handlers');
            return handleUbicacionesCall(method, params);
          })();
      if (result.handled) return result.result;
    }

    let backendParams = _maybeResolveFileTokens(params, win);
    backendParams = _validateAndResolveWriteParams(backendParams, win);
    // Inject map provider secrets from OS-backed store so the renderer never
    // needs to hold plaintext API keys for preview/generate.
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
      // Electron ipcMain.handle only clones Error.message to the renderer.
      // Throwing a plain object becomes "Error invoking remote method …: [object Object]"
      // and loses the real backend message (templates, reports, etc. look "broken").
      throw _toRendererIpcError(err);
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
  _validateAndResolveWriteParams,
  _isAllowedIpcSender,
  _sendRequest,
  _callBackend,
  _isIdempotentMethod,
  _DIALOG_NATIVE_METHODS,
  _toRendererIpcError,
  _writeStdinWithBackpressure,
  _logIpcTelemetry,
  _estimateJsonBytes,
  _getPendingRequestLimits,
  _maybeTokenizeResultPaths,
  getIpcBackpressureWaits,
  resetIpcBackpressureWaits,
  ANTARES_IPC_ERROR_PREFIX,
  reloadIpcMethods,
};
