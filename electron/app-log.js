const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const OBSERVABILITY_CONTRACT = require('../shared/observability-contract.json');
const { createAsyncLogWriter } = require('./async-log-writer');

const APP_NAME = 'Antares';
const LOG_RETENTION_DAYS = 14;
const DEFAULT_MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_DIR_BYTES = 50 * 1024 * 1024;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MANAGED_LOG_RE = /^antares-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.(?:log|jsonl)$/;
const SAFE_VALUE_RE = /^[a-zA-Z0-9_.:-]{1,160}$/;
const LEVELS = new Set(OBSERVABILITY_CONTRACT.levels);
const OUTCOMES = new Set(OBSERVABILITY_CONTRACT.outcomes);
const RUM_METRIC_NAMES = new Set(['CLS', 'INP', 'LCP']);
const RUM_RATINGS = new Set(['good', 'needs-improvement', 'poor', 'unknown']);
const RUM_NAV_TYPES = new Set([
  'navigate',
  'reload',
  'back-forward',
  'back-forward-cache',
  'prerender',
  'restore',
  'unknown',
]);
const RUM_ID_RE = /^v\d+-\d{13}-\d{13}$/;
const EVENT_FIELDS = new Set([
  'backend_pid',
  'bytes',
  'duration_ms',
  'error_code',
  'job_id',
  'lane',
  'message',
  'method',
  'operation_id',
  'outcome',
  'pid',
  'provider',
  'reason',
  'request_id',
  'status_class',
  'stream',
  'timeout_ms',
  'attempt',
  'component',
  'view',
  'count',
  'rum_name',
  'rum_value',
  'rum_rating',
  'rum_id',
  'rum_navigation_type',
]);
const SENSITIVE_TEXT_RE = [
  /(\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*)(["']?)[^\s,;"']+\2/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|tmp|var|private|opt|mnt|workspace)\/)[^\s"'`]+/g,
];
const STALE_TEMP_PREFIX_RE = /^antares-(?:backend-command|pdf|staged)-/;

const _originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let _logsDir = null;
let _consoleTeeInstalled = false;
let _sessionId = null;
let _appVersion = null;
let _backendVersion = null;
let _droppedEventCount = 0;

function resolveAppDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    APP_NAME
  );
}

function getLogsDir() {
  if (!_logsDir) _logsDir = path.join(resolveAppDataDir(), 'logs');
  return _logsDir;
}

function getSessionId() {
  if (!_sessionId) {
    _sessionId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  }
  return _sessionId;
}

function _safeContextValue(value, maxLength = 80) {
  if (value === null || value === undefined) return null;
  const safe = String(value).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, maxLength);
  return safe || null;
}

function setAppContext(context = {}) {
  if (context && typeof context === 'object') {
    if (context.appVersion !== undefined) _appVersion = _safeContextValue(context.appVersion);
    if (context.backendVersion !== undefined) _backendVersion = _safeContextValue(context.backendVersion);
  }
  getSessionId();
}

function getAppContext() {
  return {
    app_version: _appVersion,
    backend_version: _backendVersion,
    platform: process.platform,
    pid: process.pid,
    session_id: getSessionId(),
  };
}

function _todayLogPath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(getLogsDir(), `antares-${yyyy}-${mm}-${dd}.log`);
}

function _todayObservabilityLogPath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(getLogsDir(), `antares-${yyyy}-${mm}-${dd}.jsonl`);
}

function _fmtArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function _redactText(text) {
  let safeText = String(text);
  for (const pattern of SENSITIVE_TEXT_RE) {
    safeText = safeText.replace(pattern, (...matches) => {
      if (matches.length > 2 && typeof matches[1] === 'string' && matches[1].includes('Bearer')) {
        return `${matches[1]}[REDACTED]`;
      }
      if (matches.length > 3 && typeof matches[1] === 'string' && matches[2] !== undefined) {
        return `${matches[1]}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  return safeText.replace(/[\r\n]+/g, ' ').slice(0, 4000);
}

function _normaliseLevel(level) {
  const value = String(level || 'INFO').toUpperCase();
  if (value === 'WARNING') return 'WARN';
  if (value === 'CRITICAL') return 'FATAL';
  return LEVELS.has(value) ? value : 'INFO';
}

function _normaliseSafeToken(value) {
  if (value === null || value === undefined) return null;
  const safe = String(value).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 160);
  return SAFE_VALUE_RE.test(safe) ? safe : null;
}

function _normaliseEventField(key, value) {
  if (!EVENT_FIELDS.has(key)) return undefined;
  if (key === 'message') return _redactText(value);
  if (key === 'outcome') return OUTCOMES.has(value) ? value : undefined;
  if (key === 'rum_name') {
    const text = String(value ?? '').trim().toUpperCase();
    return RUM_METRIC_NAMES.has(text) ? text : undefined;
  }
  if (key === 'rum_value') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.round(value * 10000) / 10000;
  }
  if (key === 'rum_rating') {
    const text = String(value ?? '').trim().toLowerCase();
    return RUM_RATINGS.has(text) ? text : undefined;
  }
  if (key === 'rum_id') {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    return text.length <= 30 && RUM_ID_RE.test(text) ? text : '-';
  }
  if (key === 'rum_navigation_type') {
    const text = String(value ?? '').trim().toLowerCase();
    return RUM_NAV_TYPES.has(text) ? text : undefined;
  }
  if (['pid', 'backend_pid', 'bytes', 'attempt', 'count', 'timeout_ms'].includes(key)) {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (key === 'duration_ms') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  }
  return _normaliseSafeToken(value);
}

function _maxLogFileBytes() {
  const configured = Number(process.env.ANTARES_OBSERVABILITY_MAX_FILE_BYTES);
  return Number.isFinite(configured) && configured >= 128
    ? Math.floor(configured)
    : DEFAULT_MAX_LOG_FILE_BYTES;
}

function _markDroppedEvent() {
  _droppedEventCount += 1;
}

const _logWriter = createAsyncLogWriter({
  getLogsDir,
  getMaxFileBytes: _maxLogFileBytes,
  managedLogPattern: MANAGED_LOG_RE,
  maxDirectoryBytes: MAX_LOG_DIR_BYTES,
  onDrop: _markDroppedEvent,
});

function _appendManagedLine(basePath, line, onSuccess = undefined) {
  _logWriter.append(basePath, line, onSuccess);
}

function flushLogQueue() {
  return _logWriter.flush();
}

function flushLogQueueSync() {
  _logWriter.flushSync();
}

function appendLogLine(level, text) {
  try {
    const safeLevel = _normaliseLevel(level);
    const safeText = _redactText(text);
    const line = `[${new Date().toISOString()}] [${safeLevel}] [session_id=${getSessionId()}] ${safeText}\n`;
    _appendManagedLine(_todayLogPath(), line);
  } catch {
    _markDroppedEvent();
  }
}

function appendLogEvent(level, event, fields = {}) {
  const pendingDrops = _droppedEventCount;
  const record = {
    schema_version: OBSERVABILITY_CONTRACT.schema_version,
    timestamp: new Date().toISOString(),
    event: _normaliseSafeToken(event) || 'unknown',
    level: _normaliseLevel(level),
    component: 'electron',
    app_version: _appVersion,
    backend_version: _backendVersion,
    platform: process.platform,
    pid: process.pid,
    session_id: getSessionId(),
  };
  for (const [key, value] of Object.entries(fields || {})) {
    const safeValue = _normaliseEventField(key, value);
    if (safeValue !== undefined) record[key] = safeValue;
  }
  if (pendingDrops > 0) record.dropped_events = pendingDrops;
  try {
    _appendManagedLine(
      _todayObservabilityLogPath(),
      `${JSON.stringify(record)}\n`,
      () => {
        if (pendingDrops > 0) {
          _droppedEventCount = Math.max(0, _droppedEventCount - pendingDrops);
        }
      },
    );
  } catch {
    _markDroppedEvent();
  }
}

function getDroppedEventCount() {
  return _droppedEventCount;
}

function initAppLogs() {
  const dir = getLogsDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!MANAGED_LOG_RE.test(name)) continue;
      try {
        if (fs.statSync(path.join(dir, name)).mtimeMs < cutoff) {
          fs.unlinkSync(path.join(dir, name));
        }
      } catch {}
    }
  } catch {}
  return dir;
}

function logInfo(...args) {
  _originalConsole.log(...args);
  appendLogLine('INFO', args.map(_fmtArg).join(' '));
}

function installConsoleLogTee() {
  if (_consoleTeeInstalled) return;
  _consoleTeeInstalled = true;
  const raw = String(process.env.ANTARES_IPC_TELEMETRY || '').trim().toLowerCase();
  const teeLog = raw === '1' || raw === 'true' || raw === 'yes';
  console.warn = (...args) => {
    _originalConsole.warn(...args);
    appendLogLine('WARN', args.map(_fmtArg).join(' '));
  };
  console.error = (...args) => {
    _originalConsole.error(...args);
    appendLogLine('ERROR', args.map(_fmtArg).join(' '));
  };
  if (teeLog) {
    console.log = (...args) => {
      _originalConsole.log(...args);
      appendLogLine('INFO', args.map(_fmtArg).join(' '));
    };
  }
}

function _isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function _dirContentMaxMtime(p) {
  let max = 0;
  try {
    for (const entry of fs.readdirSync(p)) {
      try {
        const st = fs.statSync(path.join(p, entry));
        if (st.mtimeMs > max) max = st.mtimeMs;
      } catch {}
    }
  } catch {}
  return max;
}

function cleanStaleTempDirs() {
  let removed = 0;
  try {
    const tmpRoot = os.tmpdir();
    const cutoff = Date.now() - STALE_TEMP_MAX_AGE_MS;
    for (const name of fs.readdirSync(tmpRoot)) {
      if (!STALE_TEMP_PREFIX_RE.test(name)) continue;
      const p = path.join(tmpRoot, name);
      try {
        const st = fs.statSync(p);
        if (!st.isDirectory() || st.mtimeMs >= cutoff) continue;
        const pidMatch = /^antares-staged-(\d+)$/.exec(name);
        if (pidMatch && _isProcessAlive(Number(pidMatch[1]))) continue;
        if (_dirContentMaxMtime(p) >= cutoff) continue;
        fs.rmSync(p, { recursive: true, force: true });
        removed += 1;
      } catch {}
    }
  } catch {}
  return removed;
}

module.exports = {
  appendLogEvent,
  appendLogLine,
  cleanStaleTempDirs,
  getAppContext,
  getDroppedEventCount,
  getLogsDir,
  getSessionId,
  flushLogQueue,
  flushLogQueueSync,
  initAppLogs,
  installConsoleLogTee,
  logInfo,
  managedLogPattern: MANAGED_LOG_RE,
  redactText: _redactText,
  setAppContext,
};
