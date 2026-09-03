const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const OBSERVABILITY_CONTRACT = require('../shared/observability-contract.json');

const APP_NAME = 'Antares';
const LOG_RETENTION_DAYS = 14;
const DEFAULT_MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_DIR_BYTES = 50 * 1024 * 1024;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MANAGED_LOG_RE = /^antares-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.(?:log|jsonl)$/;
const SAFE_VALUE_RE = /^[a-zA-Z0-9_.:-]{1,160}$/;
const LEVELS = new Set(OBSERVABILITY_CONTRACT.levels);
const OUTCOMES = new Set(OBSERVABILITY_CONTRACT.outcomes);
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
  'attempt',
  'component',
  'view',
  'count',
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
let _logsDirReady = false;
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

function getObservabilityLogPath() {
  return _todayObservabilityLogPath();
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

function _safePathFor(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(p);
    }
  } catch {
    // No existe — se creará al abrir.
  }
  return p;
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
  if (['pid', 'backend_pid', 'bytes', 'attempt', 'count'].includes(key)) {
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

function _ensureLogsDir() {
  if (_logsDirReady) return;
  fs.mkdirSync(getLogsDir(), { recursive: true });
  _logsDirReady = true;
}

function _rotatedPath(basePath, index) {
  const ext = path.extname(basePath);
  return `${basePath.slice(0, -ext.length)}.${index}${ext}`;
}

function _selectLogPath(basePath, line) {
  const safeBasePath = _safePathFor(basePath);
  const lineBytes = Buffer.byteLength(line, 'utf8');
  let target = safeBasePath;
  try {
    const baseSize = fs.existsSync(safeBasePath) ? fs.statSync(safeBasePath).size : 0;
    if (baseSize + lineBytes <= _maxLogFileBytes()) return target;
    for (let index = 1; index < 1000; index += 1) {
      const candidate = _rotatedPath(safeBasePath, index);
      const candidateSize = fs.existsSync(candidate) ? fs.statSync(candidate).size : 0;
      if (candidateSize + lineBytes <= _maxLogFileBytes()) return _safePathFor(candidate);
    }
  } catch {
    // Si stat falla, se intenta escribir en el archivo base y el sink sigue
    // siendo fail-open desde el llamador.
  }
  return target;
}

function _enforceLogBudget() {
  try {
    const entries = fs.readdirSync(getLogsDir())
      .filter((name) => MANAGED_LOG_RE.test(name))
      .map((name) => {
        const filePath = path.join(getLogsDir(), name);
        const stat = fs.statSync(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= MAX_LOG_DIR_BYTES) break;
      fs.unlinkSync(entry.filePath);
      total -= entry.size;
    }
  } catch {
    // La limpieza nunca debe bloquear el flujo principal ni el sink.
  }
}

function _appendManagedLine(basePath, line) {
  _ensureLogsDir();
  fs.appendFileSync(_selectLogPath(basePath, line), line, 'utf8');
  _enforceLogBudget();
}

function _markDroppedEvent() {
  _logsDirReady = false;
  _droppedEventCount += 1;
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
    _appendManagedLine(_todayObservabilityLogPath(), `${JSON.stringify(record)}\n`);
    _droppedEventCount = 0;
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
  _logsDirReady = true;
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!MANAGED_LOG_RE.test(name)) continue;
      try {
        if (fs.statSync(path.join(dir, name)).mtimeMs < cutoff) {
          fs.unlinkSync(path.join(dir, name));
        }
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return dir;
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
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
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
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return removed;
}

module.exports = {
  appendLogEvent,
  appendLogLine,
  cleanStaleTempDirs,
  getAppContext,
  getDroppedEventCount,
  getLogsDir,
  getObservabilityLogPath,
  getSessionId,
  initAppLogs,
  installConsoleLogTee,
  redactText: _redactText,
  resolveAppDataDir,
  setAppContext,
};
