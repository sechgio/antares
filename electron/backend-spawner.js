/**
 * Python backend process lifecycle.
 *
 * Responsibilities:
 *   - Spawn the Python process (dev: venv / system python; prod: PyInstaller .exe).
 *   - Handshake: wait for the `ready` JSON-RPC notification on stdout.
 *   - Track process state (`starting` → `ready` → `exited`/`fatal`).
 *   - Capture a rolling tail of stderr so failures can be diagnosed.
 *   - Auto-restart on unexpected crashes, with bounded backoff.
 *   - Emit lifecycle notifications to the renderer (`backend.starting`,
 *     `backend.ready`, `backend.error`, `backend.restarting`, `backend.fatal`).
 *
 * The IPC router relies on `waitForReady()` and `getLastError()` to decide
 * whether to queue a pending request or fail it with a helpful message.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { getBackendCommand } = require('./backend-command');

const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  READY: 'ready',
  EXITED: 'exited',
  FATAL: 'fatal',
});

const HANDSHAKE_TIMEOUT_MS = 30_000;    // single spawn attempt timeout
const START_RETRY_LIMIT = 5;             // spawn retry count per start cycle
const MAX_AUTO_RESTARTS = Infinity;      // keep recovering from transient failures while the app is open
const MAX_RESTART_BACKOFF_SEC = 30;      // cap backoff at 30s
const RESTART_RESET_MS = 60_000;         // time of stability before counter resets
const STDERR_BUFFER_LINES = 30;          // rolling stderr tail
const HEALTH_CHECK_INTERVAL_MS = 15_000; // detect crashes faster
const HEALTH_PROBE_TIMEOUT_MS = 3_000;   // version probe is cheap — should answer in <1s

let pythonProcess = null;
let _state = STATE.IDLE;
let _isDev = false;
let _isShuttingDown = false;
let _restartCount = 0;
let _restartResetTimer = null;
let _stderrBuffer = [];
let _lastError = null;                   // { kind: 'fatal'|'transient', message, stderrTail }
let _healthCheckTimer = null;            // periodic health check interval
let _healthProbeInFlight = false;        // avoid overlapping liveness probes
let _startInProgress = false;            // prevents concurrent start/restart cycles
let _manualRestartInProgress = false;    // synchronous claim for manualRestart() concurrency
let _pendingRequestCount = 0;            // track in-flight IPC requests to avoid killing busy backend

// Promise-based readiness gate; resolves when state === READY,
// rejects when state === FATAL.
let _readyResolve = null;
let _readyReject = null;
let _readyPromise = _createReadyPromise();

function _createReadyPromise() {
  return new Promise((resolve, reject) => {
    _readyResolve = resolve;
    _readyReject = reject;
  });
}

function _resetReadyGate() {
  // Rejections must be swallowed to avoid unhandled rejection warnings
  // when no one is awaiting.
  if (_readyPromise) {
    _readyPromise.catch(() => {});
  }
  _readyPromise = _createReadyPromise();
}

function getProcess() { return pythonProcess; }
function isReady() { return _state === STATE.READY; }
function getState() { return _state; }
function getLastError() { return _lastError; }
function getStderrTail() { return _stderrBuffer.join('\n'); }
function getAutoRestartLimit() {
  return Number.isFinite(MAX_AUTO_RESTARTS) ? MAX_AUTO_RESTARTS : null;
}
function getPendingRequestCount() { return _pendingRequestCount; }
function incrementPendingRequests() { _pendingRequestCount++; }
function decrementPendingRequests() { if (_pendingRequestCount > 0) _pendingRequestCount--; }

/**
 * Wait until the backend is ready. Resolves true when ready, false when it
 * fails fatally or the timeout expires. Never rejects.
 */
async function waitForReady(timeoutMs = 60_000) {
  if (_state === STATE.READY && pythonProcess && !pythonProcess.killed) return true;
  if (_state === STATE.FATAL) return false;

  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ready = _readyPromise.then(() => true, () => false);
  const result = await Promise.race([ready, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

function _notifyRenderer(method, params) {
  try {
    const { getMainWindow } = require('./window-manager');
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('ipc-notify', method, params);
    }
  } catch {
    // window-manager may not be loaded during tests
  }
}

function _recordStderr(chunk) {
  const text = chunk.toString();
  // Forward to main-process stderr for CLI visibility
  process.stderr.write(text);
  // Keep a rolling buffer of the last N non-empty lines for diagnostics
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  for (const line of lines) {
    _stderrBuffer.push(line);
  }
  if (_stderrBuffer.length > STDERR_BUFFER_LINES) {
    _stderrBuffer = _stderrBuffer.slice(-STDERR_BUFFER_LINES);
  }
}

function _classifyStartupError(rawMessage) {
  const msg = (rawMessage || '').toLowerCase();
  // Fatal = no point retrying: executable missing, python not installed.
  if (msg.includes('backend executable not found')) return 'fatal';
  if (msg.includes('python no encontrado')) return 'fatal';
  if (msg.includes('enoent')) return 'fatal';
  return 'transient';
}

function _isFileBackedCommand(cmd) {
  return path.isAbsolute(cmd) || cmd.includes(path.sep) || cmd.includes('/') || cmd.includes('\\');
}

async function startPythonBackend(isDev, attempt = 1) {
  _isDev = isDev;
  _isShuttingDown = false;

  if (attempt === 1) {
    if (_startInProgress) {
      console.warn('[backend-spawner] Start already in progress, skipping duplicate.');
      return;
    }
    _startInProgress = true;
    _state = STATE.STARTING;
    _lastError = null;
    _stderrBuffer = [];
    _resetReadyGate();
    _notifyRenderer('backend.starting', { attempt: 1, limit: START_RETRY_LIMIT });
  }

  try {
    await _spawn(isDev);
    if (_isShuttingDown) {
      console.log('[backend-spawner] Shutdown requested after spawn, aborting.');
      _startInProgress = false;
      return;
    }
    _state = STATE.READY;
    _lastError = null;
    _startInProgress = false;
    _readyResolve?.();
    if (_restartResetTimer) clearTimeout(_restartResetTimer);
    _restartResetTimer = setTimeout(() => { _restartCount = 0; }, RESTART_RESET_MS);
    _startHealthCheck();
    _notifyRenderer('backend.ready', { version: process.env.npm_package_version || null });
  } catch (err) {
    const kind = _classifyStartupError(err.message);
    const stderrTail = getStderrTail();
    _lastError = { kind, message: err.message, stderrTail };
    console.error(`[backend-spawner] Start attempt ${attempt} failed (${kind}): ${err.message}`);
    if (stderrTail) console.error(`[backend-spawner] stderr tail:\n${stderrTail}`);

    // Only truly fatal if Python / executable is missing. Everything else keeps
    // retrying because renderer availability matters more than giving up early.
    if (kind === 'fatal') {
      _state = STATE.FATAL;
      _startInProgress = false;
      _readyReject?.(err);
      _notifyRenderer('backend.fatal', {
        message: err.message,
        stderrTail,
        attempts: attempt,
      });
      return;
    }

    // Never give up on transient failures — keep retrying with increasing backoff.
    const backoffSec = Math.min(Math.pow(2, attempt - 1), MAX_RESTART_BACKOFF_SEC);
    _notifyRenderer('backend.error', {
      message: err.message,
      stderrTail,
      attempt,
      willRetry: true,
      nextRetrySec: backoffSec,
    });
    await new Promise((r) => setTimeout(r, 1000 * backoffSec));
    if (_isShuttingDown) {
      console.log('[backend-spawner] Shutdown requested during retry delay, aborting start.');
      _startInProgress = false;
      return;
    }
    return startPythonBackend(isDev, attempt + 1);
  }
}

/**
 * Periodic health check: if the backend process exited without firing 'close',
 * or if it's a zombie, force a restart.
 */
function _probeBackendResponsiveness(proc) {
  if (!proc || proc.killed) {
    return Promise.reject(new Error('process unavailable'));
  }

  const probeId = `health-${crypto.randomUUID()}`;

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const cleanup = () => {
      proc.stdout.off('data', onData);
      proc.off('close', onClose);
      clearTimeout(timer);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onClose = () => finish(reject, new Error('process closed during probe'));
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === probeId) {
            finish(resolve, true);
            return;
          }
        } catch {
          // Ignore malformed lines; the main IPC parser already does the same.
        }
      }
    };

    const timer = setTimeout(
      () => finish(reject, new Error(`health probe timeout (>${HEALTH_PROBE_TIMEOUT_MS / 1000}s)`)),
      HEALTH_PROBE_TIMEOUT_MS,
    );

    proc.stdout.on('data', onData);
    proc.once('close', onClose);

    try {
      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: probeId,
        method: 'version',
        params: {},
      }) + '\n');
    } catch (err) {
      finish(reject, new Error(`health probe write failed: ${err.message}`));
    }
  });
}

async function runHealthCheckOnce() {
  if (_isShuttingDown || _state !== STATE.READY || _healthProbeInFlight) return;
  if (!pythonProcess || pythonProcess.killed) {
    console.warn('[backend-spawner] Health check: process is gone, triggering restart.');
    await _autoRestart();
    return;
  }

  _healthProbeInFlight = true;
  const probedProcess = pythonProcess;
  try {
    await _probeBackendResponsiveness(probedProcess);
  } catch (err) {
    if (_isShuttingDown || probedProcess !== pythonProcess) return;
    // If there are in-flight requests, the backend is likely busy — not dead.
    // A health probe timeout during active work is a false positive; restarting
    // would kill the user's operation mid-flight.
    if (_pendingRequestCount > 0) {
      console.log(`[backend-spawner] Health probe timed out but ${_pendingRequestCount} request(s) in flight — skipping restart (backend is busy, not dead).`);
      return;
    }
    // Re-check synchronously immediately before triggering a restart: a new
    // request could have arrived between the probe failing and this point
    // (await boundaries are scheduling points). Avoid killing it mid-flight.
    if (_pendingRequestCount > 0) {
      console.log(`[backend-spawner] Pending request arrived during probe failure handling — skipping restart.`);
      return;
    }
    const message = `Backend no responde al chequeo de salud: ${err.message}`;
    _lastError = { kind: 'transient', message, stderrTail: getStderrTail() };
    console.warn(`[backend-spawner] ${message}`);
    _notifyRenderer('backend.error', {
      message,
      stderrTail: getStderrTail(),
      attempt: _restartCount,
      willRetry: true,
      nextRetrySec: 0,
    });
    await manualRestart(_isDev, { force: true });
  } finally {
    _healthProbeInFlight = false;
  }
}

function _startHealthCheck() {
  if (_healthCheckTimer) clearInterval(_healthCheckTimer);
  _healthCheckTimer = setInterval(() => {
    runHealthCheckOnce().catch((err) => console.error('[backend-spawner] Health check failed:', err));
  }, HEALTH_CHECK_INTERVAL_MS);
}

function _stopHealthCheck() {
  if (_healthCheckTimer) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
}

async function _autoRestart() {
  if (_isShuttingDown) return;
  if (_startInProgress) {
    console.warn('[backend-spawner] Auto-restart skipped: start already in progress.');
    return;
  }
  _restartCount++;
  console.warn(`[backend-spawner] Auto-restart attempt ${_restartCount} (unlimited)`);

  _state = STATE.STARTING;
  _resetReadyGate();
  _notifyRenderer('backend.restarting', {
    attempt: _restartCount,
    limit: null,
  });

  // Exponential backoff with a cap so we don't spam too fast
  const backoffSec = Math.min(Math.pow(2, _restartCount - 1), MAX_RESTART_BACKOFF_SEC);
  await new Promise((r) => setTimeout(r, 1000 * backoffSec));
  if (_isShuttingDown) {
    console.log('[backend-spawner] Shutdown requested during auto-restart backoff, aborting.');
    _startInProgress = false;
    return;
  }
  await startPythonBackend(_isDev);
}

function _spawn(isDev) {
  let { cmd, args } = getBackendCommand(isDev, process.platform, __dirname);

  if (isDev && _isFileBackedCommand(cmd) && !fs.existsSync(cmd)) {
    throw new Error('Python no encontrado: ni el entorno virtual ni Python del sistema están disponibles.');
  }
  if (!isDev && !fs.existsSync(cmd)) {
    throw new Error(`Backend executable not found: ${cmd}`);
  }

  pythonProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  pythonProcess.stderr.on('data', _recordStderr);
  pythonProcess.stdin.on('error', (err) => {
    console.error('[backend-spawner] stdin error:', err.message);
  });

  const spawnedPid = pythonProcess.pid;
  pythonProcess.on('close', (code, signal) => {
    console.log(`[backend-spawner] Python backend exited (code=${code}, signal=${signal})`);
    const wasReady = _state === STATE.READY;
    // Only null out pythonProcess if it still references this closed process.
    // Prevents race where a new process was already spawned.
    if (pythonProcess && pythonProcess.pid === spawnedPid) {
      pythonProcess = null;
    }
    _state = wasReady ? STATE.EXITED : _state;

    if (wasReady && !_isShuttingDown) {
      // Unexpected crash after being healthy → try to restart.
      _autoRestart().catch((err) => console.error('[backend-spawner] Auto-restart failed:', err));
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('[backend-spawner] Failed to start Python backend:', err);
    // The handshake promise below will reject on timeout; no dialog here —
    // let startPythonBackend() decide how to surface the failure.
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    let handshakeDone = false;
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'ready') {
            handshakeDone = true;
            clearTimeout(handshakeTimer);
            pythonProcess.stdout.off('data', onData);
            resolve();
            return;
          }
        } catch { /* not JSON yet */ }
      }
    };
    pythonProcess.stdout.on('data', onData);

    const handshakeTimer = setTimeout(() => {
      pythonProcess?.stdout.off('data', onData);
      if (pythonProcess && !pythonProcess.killed) {
        _forceKillProcess(pythonProcess);
      }
      const tail = getStderrTail();
      const detail = tail ? `\nÚltima salida de Python:\n${tail}` : '';
      handshakeDone = true;
      reject(new Error(`Python backend handshake timeout (>${HANDSHAKE_TIMEOUT_MS / 1000}s)${detail}`));
    }, HANDSHAKE_TIMEOUT_MS);

    pythonProcess.once('close', (code, signal) => {
      clearTimeout(handshakeTimer);
      pythonProcess?.stdout.off('data', onData);
      if (!handshakeDone) {
        handshakeDone = true;
        const tail = getStderrTail();
        const detail = tail ? `\nÚltima salida de Python:\n${tail}` : '';
        reject(new Error(`Python backend exited before handshake (code=${code}, signal=${signal})${detail}`));
      }
    });
  });
}

function _forceKillProcess(proc) {
  if (!proc || proc.killed) return;
  try { proc.stdin.end(); } catch { /* ignore */ }
  try { proc.kill(); } catch { /* ignore */ }
  // On Windows, child processes may survive SIGTERM. Use taskkill to force-kill
  // the entire process tree to prevent zombie processes from blocking the port
  // or holding file locks.
  if (process.platform === 'win32' && proc.pid && typeof proc.pid === 'number') {
    try {
      // Keep shutdown responsive while Windows tears down the child tree.
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }, () => {});
    } catch { /* process may already be dead */ }
  }
}

function killPython() {
  _isShuttingDown = true;
  _state = STATE.EXITED;
  _stopHealthCheck();
  if (_restartResetTimer) clearTimeout(_restartResetTimer);
  _forceKillProcess(pythonProcess);
}

/**
 * Manual restart: reset the FATAL state so a fresh start cycle can proceed.
 * Returns true if a start cycle was kicked off, false if already running.
 */
async function manualRestart(isDev, { force = false } = {}) {
  // If already ready, nothing to do
  if (!force && _state === STATE.READY && pythonProcess && !pythonProcess.killed) {
    return true;
  }
  // Synchronous claim — both concurrent callers cannot pass this guard.
  // _startInProgress alone is insufficient because it is only flipped inside
  // startPythonBackend's `attempt === 1` branch, leaving a window where two
  // manualRestart() calls both see it as false.
  if (_manualRestartInProgress || _startInProgress) {
    console.warn('[backend-spawner] Manual restart skipped: start already in progress.');
    return false;
  }
  _manualRestartInProgress = true;

  try {
    // Kill any lingering process (handles Windows zombie processes)
    _forceKillProcess(pythonProcess);
    pythonProcess = null;
    _stopHealthCheck();

    // Reset ANY state so startPythonBackend can proceed — even if previously fatal.
    _state = STATE.IDLE;
    _restartCount = 0;
    _lastError = null;
    _stderrBuffer = [];
    _isShuttingDown = false;

    await startPythonBackend(isDev);
    return isReady();
  } finally {
    _startInProgress = false;
    _manualRestartInProgress = false;
  }
}

module.exports = {
  startPythonBackend,
  getProcess,
  killPython,
  manualRestart,
  isReady,
  waitForReady,
  getState,
  getLastError,
  getStderrTail,
  getAutoRestartLimit,
  runHealthCheckOnce,
  incrementPendingRequests,
  decrementPendingRequests,
  getPendingRequestCount,
  STATE,
};
