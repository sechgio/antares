const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { getBackendCommand } = require('./backend-command');
const {
  appendLogEvent,
  appendLogLine,
  getAppContext,
  redactText,
  setAppContext,
} = require('./app-log');

const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  READY: 'ready',
  EXITED: 'exited',
  FATAL: 'fatal',
});

const HANDSHAKE_TIMEOUT_MS = 60_000;
const AUTO_RESTART_LIMIT = 8;
const RESTART_BACKOFF_BASE_MS = 1_000;
const MAX_RESTART_BACKOFF_MS = 30_000;
const RESTART_RESET_MS = 60_000;
const STDERR_BUFFER_LINES = 30;
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

let pythonProcess = null;
let _state = STATE.IDLE;
let _isDev = false;
let _isShuttingDown = false;
let _restartCount = 0;
let _restartResetTimer = null;
let _stderrBuffer = [];
let _stderrLineBuffer = '';
let _lastError = null;
let _healthCheckTimer = null;
let _healthProbeInFlight = false;
let _currentStart = null;
let _autoRestartAbort = null;
let _autoRestartInProgress = false;
let _manualRestartInProgress = false;
let _pendingRequestCount = 0;
let _lastJobActivityAt = 0;
const JOB_ACTIVITY_GRACE_MS = 60_000;
let _healthStatus = {
  last_probe_at: null,
  last_success_at: null,
  last_probe_ms: null,
  last_probe_outcome: null,
  consecutive_failures: 0,
  skipped_total: 0,
  last_skip_reason: null,
  last_failure_at: null,
  last_failure_reason: null,
  probes_total: 0,
  successes_total: 0,
  failures_total: 0,
  restarts_total: 0,
};

let _readyResolve = null;
let _readyReject = null;
let _readyGatePending = false;
let _readyPromise = _createReadyPromise();

function _createReadyPromise() {
  _readyGatePending = true;
  return new Promise((resolve, reject) => {
    _readyResolve = () => { _readyGatePending = false; resolve(); };
    _readyReject = (err) => { _readyGatePending = false; reject(err); };
  });
}

function _resetReadyGate() {
  if (_readyGatePending) return;
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
  return AUTO_RESTART_LIMIT;
}
function getPendingRequestCount() { return _pendingRequestCount; }
function incrementPendingRequests() { _pendingRequestCount++; }
function decrementPendingRequests() { if (_pendingRequestCount > 0) _pendingRequestCount--; }

function noteJobActivity() {
  _lastJobActivityAt = Date.now();
}

function clearJobActivity() {
  _lastJobActivityAt = 0;
}

function hasRecentJobActivity(windowMs = JOB_ACTIVITY_GRACE_MS) {
  if (!_lastJobActivityAt) return false;
  return (Date.now() - _lastJobActivityAt) < windowMs;
}

function getHealthStatus() {
  return { ..._healthStatus };
}

function _recordHealthSkip(reason) {
  _healthStatus.skipped_total += 1;
  _healthStatus.last_skip_reason = reason;
  appendLogEvent('INFO', 'backend.health', {
    component: 'backend',
    outcome: 'degraded',
    reason,
  });
}

function _healthFailureReason(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timeout')) return 'probe_timeout';
  if (message.includes('write failed')) return 'probe_write_failed';
  if (message.includes('closed')) return 'process_closed';
  return 'probe_failed';
}

function _recordHealthProbe({ outcome, durationMs, reason, errorCode = undefined }) {
  const now = new Date().toISOString();
  _healthStatus.probes_total += 1;
  _healthStatus.last_probe_at = now;
  _healthStatus.last_probe_ms = Math.max(0, Math.round(durationMs));
  _healthStatus.last_probe_outcome = outcome;
  if (outcome === 'success') {
    _healthStatus.successes_total += 1;
    _healthStatus.last_success_at = now;
    _healthStatus.consecutive_failures = 0;
    _healthStatus.last_skip_reason = null;
  } else {
    _healthStatus.failures_total += 1;
    _healthStatus.consecutive_failures += 1;
    _healthStatus.last_failure_at = now;
    _healthStatus.last_failure_reason = reason;
  }
  appendLogEvent(outcome === 'success' ? 'INFO' : outcome === 'timeout' ? 'WARN' : 'ERROR', 'backend.health', {
    component: 'backend',
    outcome,
    duration_ms: durationMs,
    reason,
    error_code: errorCode,
  });
}

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
  }
}

function _resolveAppVersion() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getVersion === 'function') return app.getVersion();
  } catch {
  }
  return process.env.npm_package_version || null;
}

function _stderrLevel(line) {
  const structured = _parseStructuredStderr(line);
  if (structured?.level) {
    const level = String(structured.level).toUpperCase();
    if (level === 'WARNING') return 'WARN';
    if (level === 'CRITICAL') return 'FATAL';
    if (['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(level)) return level;
  }
  const match = /^\[(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\]/i.exec(line.trim());
  if (!match) return 'INFO';
  const level = match[1].toUpperCase();
  if (level === 'WARNING') return 'WARN';
  if (level === 'CRITICAL') return 'FATAL';
  return level;
}

function _parseStructuredStderr(line) {
  if (!line.trim().startsWith('{')) return null;
  try {
    const payload = JSON.parse(line);
    if (!payload || typeof payload !== 'object' || typeof payload.event !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

function _persistStderrLine(line, sourcePid) {
  const structured = _parseStructuredStderr(line);
  if (structured?.backend_version) {
    setAppContext({ backendVersion: structured.backend_version });
  }
  const safeLine = redactText(structured?.message ?? line);
  if (!safeLine.trim()) return;
  _stderrBuffer.push(safeLine);
  const level = _stderrLevel(line);
  const backendPid = Number.isInteger(sourcePid)
    ? sourcePid
    : (Number.isInteger(structured?.backend_pid) ? structured.backend_pid : structured?.pid);
  appendLogLine(level, `[backend pid=${backendPid || 'unknown'}] ${safeLine}`);
  appendLogEvent(level, structured?.event || 'backend.stderr', {
    component: 'backend',
    pid: Number.isInteger(backendPid) ? backendPid : undefined,
    backend_pid: Number.isInteger(backendPid) ? backendPid : undefined,
    stream: 'stderr',
    message: safeLine,
    request_id: structured?.request_id,
    job_id: structured?.job_id,
    method: structured?.method,
    lane: structured?.lane,
    operation_id: structured?.operation_id,
    outcome: structured?.outcome,
    duration_ms: structured?.duration_ms,
    error_code: structured?.error_code,
    attempt: structured?.attempt,
    reason: structured?.reason,
    rum_name: structured?.rum_name,
    rum_value: structured?.rum_value,
    rum_rating: structured?.rum_rating,
    rum_id: structured?.rum_id,
    rum_navigation_type: structured?.rum_navigation_type,
  });
}

function _recordStderr(chunk, sourcePid) {
  const text = chunk.toString();
  process.stderr.write(text);
  _stderrLineBuffer += text;
  const lines = _stderrLineBuffer.split(/\r?\n/);
  _stderrLineBuffer = lines.pop() || '';
  for (const line of lines) {
    _persistStderrLine(line.trimEnd(), sourcePid);
  }
  if (_stderrBuffer.length > STDERR_BUFFER_LINES) {
    _stderrBuffer = _stderrBuffer.slice(-STDERR_BUFFER_LINES);
  }
}

function _flushStderr(sourcePid) {
  if (!_stderrLineBuffer) return;
  _persistStderrLine(_stderrLineBuffer.trimEnd(), sourcePid);
  _stderrLineBuffer = '';
  if (_stderrBuffer.length > STDERR_BUFFER_LINES) {
    _stderrBuffer = _stderrBuffer.slice(-STDERR_BUFFER_LINES);
  }
}

function _abortController(ac, reason) {
  if (ac) ac.abort();
  if (reason) console.warn(`[backend-spawner] ${reason}`);
}

function _clearStartCycle() {
  _currentStart = null;
}

function _releaseStartCycleIfOwned(myAbort) {
  if (!myAbort || _currentStart?.abort !== myAbort) return;
  _clearStartCycle();
  if (_readyGatePending) {
    _readyReject?.(new Error('Backend start aborted'));
  }
}

function _preemptStartCycle(reason) {
  _abortController(
    _currentStart?.abort,
    reason ? `Preempted in-flight start cycle: ${reason}` : null,
  );
  _clearStartCycle();
}

function _clearAutoRestartCycle() {
  _autoRestartAbort = null;
}

function _abortAutoRestart(reason) {
  _abortController(
    _autoRestartAbort,
    reason ? `Aborted in-flight auto-restart: ${reason}` : null,
  );
  _clearAutoRestartCycle();
}

function _sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

function _emitFatalEvent(message, reason, attempts) {
  appendLogEvent('ERROR', 'backend.fatal', {
    component: 'backend',
    outcome: 'failed',
    reason,
    attempt: Number.isInteger(attempts) ? attempts : undefined,
    message,
  });
}

function _enterFatalFromRestartBudget(message) {
  const stderrTail = getStderrTail();
  const fatalMessage = message || `Backend auto-restart budget exhausted (${getAutoRestartLimit()} attempts)`;
  _lastError = { kind: 'fatal', message: fatalMessage, stderrTail };
  _state = STATE.FATAL;
  _clearStartCycle();
  _abortAutoRestart();
  _stopHealthCheck();
  _readyReject?.(new Error(fatalMessage));
  _emitFatalEvent(fatalMessage, 'restart_budget_exhausted', _restartCount);
  _notifyRenderer('backend.fatal', {
    message: fatalMessage,
    stderrTail,
    attempts: _restartCount,
  });
}

function _classifyStartupError(rawMessage) {
  const msg = (rawMessage || '').toLowerCase();
  if (msg.includes('backend executable not found')) return 'fatal';
  if (msg.includes('python no encontrado')) return 'fatal';
  if (msg.includes('enoent')) return 'fatal';
  if (msg.includes('init_db failed')) return 'fatal';
  if (msg.includes('db_init_failed')) return 'fatal';
  return 'transient';
}

function _isFileBackedCommand(cmd) {
  return path.isAbsolute(cmd) || cmd.includes(path.sep) || cmd.includes('/') || cmd.includes('\\');
}

function _getRestartBackoffMs(attempt) {
  const normalizedAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  return Math.min(
    RESTART_BACKOFF_BASE_MS * Math.pow(2, normalizedAttempt - 1),
    MAX_RESTART_BACKOFF_MS,
  );
}

async function startPythonBackend(isDev, attempt = 1) {
  _isDev = isDev;
  if (_isShuttingDown) {
    console.log('[backend-spawner] Shutdown requested, aborting start.');
    _clearStartCycle();
    return;
  }

  if (attempt === 1) {
    if (_isShuttingDown) {
      console.log('[backend-spawner] Shutdown requested, aborting start.');
      _clearStartCycle();
      return;
    }
    if (_currentStart?.inProgress) {
      console.warn('[backend-spawner] Start already in progress, skipping duplicate.');
      return;
    }
    _currentStart = { inProgress: true, abort: new AbortController() };
    _state = STATE.STARTING;
    _lastError = null;
    _stderrBuffer = [];
    _resetReadyGate();
    _notifyRenderer('backend.starting', { attempt: 1, limit: getAutoRestartLimit() });
  }

  const myAbort = _currentStart?.abort;
  const cycleSignal = myAbort?.signal;

  try {
    const myPid = await _spawn(isDev);
    if (_isShuttingDown || cycleSignal?.aborted) {
      console.log('[backend-spawner] Start cycle aborted after spawn.');
      if (pythonProcess?.pid === myPid) {
        _forceKillProcess(pythonProcess);
        pythonProcess = null;
      }
      _releaseStartCycleIfOwned(myAbort);
      return;
    }
    _lastError = null;
    _clearStartCycle();
    _state = STATE.READY;
    _readyResolve?.();
    if (_restartResetTimer) clearTimeout(_restartResetTimer);
    _restartResetTimer = setTimeout(() => { _restartCount = 0; }, RESTART_RESET_MS);
    _startHealthCheck();
    _notifyRenderer('backend.ready', { version: _resolveAppVersion() });
  } catch (err) {
    if (cycleSignal?.aborted) {
      _releaseStartCycleIfOwned(myAbort);
      return;
    }

    const kind = _classifyStartupError(err.message);
    const stderrTail = getStderrTail();
    _lastError = { kind, message: err.message, stderrTail };
    console.error(`[backend-spawner] Start attempt ${attempt} failed (${kind}): ${err.message}`);
    if (stderrTail) console.error(`[backend-spawner] stderr tail:\n${stderrTail}`);

    if (kind === 'fatal') {
      _state = STATE.FATAL;
      _clearStartCycle();
      _readyReject?.(err);
      _emitFatalEvent(err.message, 'startup_error_fatal', attempt);
      _notifyRenderer('backend.fatal', {
        message: err.message,
        stderrTail,
        attempts: attempt,
      });
      return;
    }

    if (attempt >= getAutoRestartLimit()) {
      _state = STATE.FATAL;
      _clearStartCycle();
      _readyReject?.(err);
      _emitFatalEvent(err.message, 'restart_budget_exhausted', attempt);
      _notifyRenderer('backend.fatal', {
        message: err.message,
        stderrTail,
        attempts: attempt,
      });
      return;
    }

    const backoffMs = _getRestartBackoffMs(attempt);
    _notifyRenderer('backend.error', {
      message: err.message,
      stderrTail,
      attempt,
      willRetry: true,
      nextRetrySec: backoffMs / 1_000,
    });
    await _sleep(backoffMs, cycleSignal);
    if (_isShuttingDown || cycleSignal?.aborted) {
      console.log('[backend-spawner] Start cycle aborted during retry delay.');
      _releaseStartCycleIfOwned(myAbort);
      return;
    }
    return startPythonBackend(isDev, attempt + 1);
  }
}

function _probeBackendResponsiveness(proc) {
  if (!proc || proc.killed) {
    return Promise.reject(new Error('process unavailable'));
  }

  const probeId = `health-${crypto.randomUUID()}`;
  const probeIdBytes = Buffer.from(probeId, 'utf8');

  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
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
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const buf = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let start = 0;
      for (;;) {
        const idx = buf.indexOf(0x0a, start);
        if (idx === -1) break;
        if (idx > start) {
          const lineBuf = buf.subarray(start, idx);
          if (lineBuf.includes(probeIdBytes)) {
            try {
              const msg = JSON.parse(lineBuf.toString('utf8'));
              if (msg.id === probeId) {
                finish(resolve, true);
                return;
              }
            } catch {
            }
          }
        }
        start = idx + 1;
      }
      pending = start === 0 ? buf : buf.subarray(start);
      if (pending.length > 128 * 1024) {
        pending = Buffer.alloc(0);
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
  if (_isShuttingDown || _state !== STATE.READY) {
    _recordHealthSkip('not_ready');
    return;
  }
  if (_healthProbeInFlight) {
    _recordHealthSkip('probe_in_flight');
    return;
  }
  if (!pythonProcess || pythonProcess.killed) {
    _recordHealthProbe({
      outcome: 'failed',
      durationMs: 0,
      reason: 'process_gone',
      errorCode: 'process_unavailable',
    });
    console.warn('[backend-spawner] Health check: process is gone, triggering restart.');
    await _autoRestart('process_gone');
    return;
  }

  _healthProbeInFlight = true;
  const probedProcess = pythonProcess;
  const probeStartedAt = Date.now();
  try {
    await _probeBackendResponsiveness(probedProcess);
    _recordHealthProbe({
      outcome: 'success',
      durationMs: Date.now() - probeStartedAt,
      reason: 'liveness',
    });
  } catch (err) {
    if (_isShuttingDown || probedProcess !== pythonProcess) {
      _recordHealthSkip('process_replaced');
      return;
    }
    const failureReason = _healthFailureReason(err);
    _recordHealthProbe({
      outcome: failureReason === 'probe_timeout' ? 'timeout' : 'failed',
      durationMs: Date.now() - probeStartedAt,
      reason: failureReason,
      errorCode: failureReason,
    });
    if (_pendingRequestCount > 0) {
      _recordHealthSkip('requests_in_flight');
      console.log(`[backend-spawner] Health probe timed out but ${_pendingRequestCount} request(s) in flight — skipping restart (backend is busy, not dead).`);
      return;
    }
    if (hasRecentJobActivity()) {
      _recordHealthSkip('job_active');
      console.log('[backend-spawner] Health probe timed out but a job was recently active — skipping restart (backend is busy, not dead).');
      return;
    }
    if (_pendingRequestCount > 0) {
      _recordHealthSkip('requests_in_flight_after_probe');
      console.log(`[backend-spawner] Pending request arrived during probe failure handling — skipping restart.`);
      return;
    }
    if (hasRecentJobActivity()) {
      _recordHealthSkip('job_active_after_probe');
      console.log('[backend-spawner] Job activity arrived during probe failure handling — skipping restart.');
      return;
    }
    const message = `Backend no responde al chequeo de salud: ${err.message}`;
    _lastError = { kind: 'transient', message, stderrTail: getStderrTail() };
    console.warn(`[backend-spawner] ${message}`);
    const willRetry = _restartCount < getAutoRestartLimit();
    const nextRetrySec = willRetry
      ? _getRestartBackoffMs(_restartCount + 1) / 1_000
      : 0;
    _notifyRenderer('backend.error', {
      message,
      stderrTail: getStderrTail(),
      attempt: _restartCount,
      willRetry,
      nextRetrySec,
    });
    await _autoRestart('health_probe_failed', probedProcess.pid, { replaceProcess: probedProcess });
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

async function _autoRestart(reason = 'unexpected_exit', previousPid = null, { replaceProcess = null } = {}) {
  if (_isShuttingDown || _manualRestartInProgress || _autoRestartInProgress) return;
  if (_state === STATE.FATAL) return;
  if (_currentStart?.inProgress) {
    console.warn('[backend-spawner] Auto-restart skipped: start already in progress.');
    return;
  }
  if (_restartCount >= getAutoRestartLimit()) {
    _enterFatalFromRestartBudget();
    return;
  }

  _autoRestartInProgress = true;
  const restartStartedAt = Date.now();
  const oldPid = Number.isInteger(previousPid)
    ? previousPid
    : (Number.isInteger(pythonProcess?.pid) ? pythonProcess.pid : null);
  _healthStatus.restarts_total += 1;
  try {
    _abortAutoRestart();
    _autoRestartAbort = new AbortController();
    const restartSignal = _autoRestartAbort.signal;

    _restartCount++;
    console.warn(`[backend-spawner] Auto-restart attempt ${_restartCount}/${getAutoRestartLimit()}`);
    appendLogEvent('WARN', 'backend.restarting', {
      component: 'backend',
      pid: oldPid || undefined,
      backend_pid: oldPid || undefined,
      outcome: 'failed',
      attempt: _restartCount,
      reason,
    });

    _state = STATE.STARTING;
    _resetReadyGate();
    _notifyRenderer('backend.restarting', {
      attempt: _restartCount,
      limit: getAutoRestartLimit(),
    });

    await _sleep(_getRestartBackoffMs(_restartCount), restartSignal);
    if (_isShuttingDown || _manualRestartInProgress || _currentStart?.inProgress || restartSignal.aborted) {
      if (_isShuttingDown) {
        console.log('[backend-spawner] Shutdown requested during auto-restart backoff, aborting.');
      }
      _clearAutoRestartCycle();
      return;
    }
    if (isReady() && pythonProcess && !pythonProcess.killed) {
      _clearAutoRestartCycle();
      return;
    }
    if (replaceProcess && pythonProcess === replaceProcess) {
      _forceKillProcess(pythonProcess);
      pythonProcess = null;
    }
    _clearAutoRestartCycle();
    await startPythonBackend(_isDev);
    if (isReady() && pythonProcess) {
      appendLogEvent('INFO', 'backend.restarted', {
        component: 'backend',
        pid: Number.isInteger(pythonProcess.pid) ? pythonProcess.pid : undefined,
        backend_pid: Number.isInteger(pythonProcess.pid) ? pythonProcess.pid : undefined,
        outcome: 'success',
        attempt: _restartCount,
        duration_ms: Date.now() - restartStartedAt,
        reason,
      });
    }
  } finally {
    _autoRestartInProgress = false;
  }
}

const _CHILD_ENV_WHITELIST = [
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'OS',
  'TEMP', 'TMP', 'PYTHONIOENCODING', 'PYTHONUTF8',
  'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'XDG_DATA_HOME', 'USERNAME', 'USER',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
];
const _CHILD_ENV_DEV_ONLY = ['PYTHONPATH', 'VIRTUAL_ENV'];

function _buildChildEnv(isDev = false) {
  const env = {};
  for (const key of _CHILD_ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (isDev) {
    for (const key of _CHILD_ENV_DEV_ONLY) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ANTARES_') && process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  const appContext = getAppContext();
  env.ANTARES_SESSION_ID = appContext.session_id;
  if (appContext.app_version) env.ANTARES_APP_VERSION = appContext.app_version;
  env.ANTARES_IPC_TELEMETRY = '1';
  return env;
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
    env: _buildChildEnv(isDev),
  });

  const spawnedProcess = pythonProcess;
  const spawnedPid = spawnedProcess.pid;
  appendLogEvent('INFO', 'backend.starting', {
    component: 'backend',
    pid: Number.isInteger(spawnedPid) ? spawnedPid : undefined,
  });

  spawnedProcess.stderr.on('data', (chunk) => _recordStderr(chunk, spawnedPid));
  spawnedProcess.stdin.on('error', (err) => {
    console.error('[backend-spawner] stdin error:', err.message);
  });
  const spawnStartedAtMs = Date.now();

  spawnedProcess.on('close', (code, signal) => {
    _flushStderr(spawnedPid);
    console.log(`[backend-spawner] Python backend exited (code=${code}, signal=${signal})`);
    const wasReady = _state === STATE.READY;
    const isCleanShutdown = !!_isShuttingDown;
    // Un cierre ordenado del backend (quit de la app) no es un fallo:
    // se registra como INFO/cancelled para no contaminar señales de crash.
    appendLogEvent(isCleanShutdown ? 'INFO' : (wasReady ? 'WARN' : 'INFO'), 'backend.exited', {
      component: 'backend',
      pid: Number.isInteger(spawnedPid) ? spawnedPid : undefined,
      outcome: isCleanShutdown ? 'cancelled' : (wasReady ? 'failed' : 'cancelled'),
      reason: isCleanShutdown ? 'shutdown' : (signal ? 'signal' : 'exit'),
    });
    if (pythonProcess && pythonProcess.pid === spawnedPid) {
      pythonProcess = null;
    }
    _state = wasReady ? STATE.EXITED : _state;

    if (wasReady && !_isShuttingDown && _state !== STATE.FATAL) {
      const stderrTail = getStderrTail();
      if (/init_db failed|db_init_failed/i.test(stderrTail)) {
        _enterFatalFromRestartBudget(
          'La base de datos local no pudo inicializarse. Revisa permisos o reinstala la app.',
        );
        return;
      }
      _autoRestart('unexpected_exit', spawnedPid).catch((err) => console.error('[backend-spawner] Auto-restart failed:', err));
    }
  });

  spawnedProcess.on('error', (err) => {
    console.error('[backend-spawner] Failed to start Python backend:', err);
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
            spawnedProcess.stdout.off('data', onData);
            if (msg.params?.backend_version) {
              setAppContext({ backendVersion: msg.params.backend_version });
            }
            appendLogEvent('INFO', 'backend.ready', {
              component: 'backend',
              pid: Number.isInteger(spawnedPid) ? spawnedPid : undefined,
              outcome: 'success',
              duration_ms: Date.now() - spawnStartedAtMs,
            });
            resolve(spawnedPid);
            return;
          }
        } catch {}
      }
    };
    spawnedProcess.stdout.on('data', onData);

    const handshakeTimer = setTimeout(() => {
      spawnedProcess.stdout.off('data', onData);
      if (pythonProcess && pythonProcess.pid === spawnedPid && !pythonProcess.killed) {
        _forceKillProcess(pythonProcess);
      }
      const tail = getStderrTail();
      const detail = tail ? `\nÚltima salida de Python:\n${tail}` : '';
      handshakeDone = true;
      reject(new Error(`Python backend handshake timeout (>${HANDSHAKE_TIMEOUT_MS / 1000}s)${detail}`));
    }, HANDSHAKE_TIMEOUT_MS);

    spawnedProcess.once('close', (code, signal) => {
      clearTimeout(handshakeTimer);
      spawnedProcess.stdout.off('data', onData);
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
  try { proc.stdin.end(); } catch {}
  try { proc.kill(); } catch {}
  if (process.platform === 'win32' && proc.pid && typeof proc.pid === 'number') {
    try {
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }, () => {});
    } catch {}
  }
}

function killPython() {
  _isShuttingDown = true;
  _preemptStartCycle();
  _abortAutoRestart();
  _state = STATE.EXITED;
  _stopHealthCheck();
  if (_restartResetTimer) clearTimeout(_restartResetTimer);
  _forceKillProcess(pythonProcess);
}

async function manualRestart(isDev, { force = false, reason = null } = {}) {
  if (!force && _state === STATE.READY && pythonProcess && !pythonProcess.killed) {
    return true;
  }
  if (_manualRestartInProgress) {
    console.warn('[backend-spawner] Manual restart skipped: another manual restart is in progress.');
    return false;
  }
  _manualRestartInProgress = true;

  if (_isShuttingDown) {
    console.warn('[backend-spawner] Manual restart aborted: shutdown in progress.');
    _manualRestartInProgress = false;
    return false;
  }
  const restartStartedAt = Date.now();
  const oldPid = Number.isInteger(pythonProcess?.pid) ? pythonProcess.pid : null;
  _healthStatus.restarts_total += 1;

  try {
    _preemptStartCycle('manual restart requested');
    _abortAutoRestart('manual restart requested');

    _forceKillProcess(pythonProcess);
    pythonProcess = null;
    _stopHealthCheck();

    if (_isShuttingDown) {
      console.warn('[backend-spawner] Manual restart aborted: shutdown arrived during cleanup.');
      return false;
    }

    _state = STATE.IDLE;
    _restartCount = 0;
    if (_restartResetTimer) clearTimeout(_restartResetTimer);
    _restartResetTimer = null;
    _lastError = null;
    _stderrBuffer = [];
    clearJobActivity();

    if (_isShuttingDown) {
      console.warn('[backend-spawner] Manual restart aborted: shutdown arrived before start.');
      return false;
    }

    const restartReason = reason || (force ? 'forced' : 'manual');
    _notifyRenderer('backend.restarting', {
      reason: restartReason,
      attempt: 1,
      limit: getAutoRestartLimit(),
    });
    appendLogEvent('INFO', 'backend.restarting', {
      component: 'backend',
      pid: oldPid || undefined,
      backend_pid: oldPid || undefined,
      outcome: 'success',
      attempt: 1,
      reason: restartReason,
    });

    await startPythonBackend(isDev);
    if (isReady() && pythonProcess) {
      appendLogEvent('INFO', 'backend.restarted', {
        component: 'backend',
        pid: Number.isInteger(pythonProcess.pid) ? pythonProcess.pid : undefined,
        backend_pid: Number.isInteger(pythonProcess.pid) ? pythonProcess.pid : undefined,
        outcome: 'success',
        attempt: 1,
        duration_ms: Date.now() - restartStartedAt,
        reason: restartReason,
      });
    }
    return isReady();
  } finally {
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
  getHealthStatus,
  getLastError,
  getStderrTail,
  getAutoRestartLimit,
  runHealthCheckOnce,
  incrementPendingRequests,
  decrementPendingRequests,
  getPendingRequestCount,
  noteJobActivity,
  clearJobActivity,
  hasRecentJobActivity,
  _buildChildEnv,
  _recordStderr,
  _flushStderr,
  STATE,
};
