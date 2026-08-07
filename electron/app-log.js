// electron/app-log.js
// Persistencia mínima de logs del proceso principal en el data dir de la app.
// Usa la MISMA convención que backend/utils/paths.py: en Windows
// %LOCALAPPDATA%\Antares\logs. Sin dependencias de Electron — testeable con
// node plano (los tests de integración corren fuera de Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'Antares';
const LOG_RETENTION_DAYS = 14;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Prefixos de mkdtemp/artefactos temporales que pueden quedar huérfanos tras
// un crash o una sesión interrumpida (tests de backend-command, export PDF,
// staging de archivos). Excluye cachés/almacenes persistentes
// (antares-thumb-cache, antares-autoimg).
const STALE_TEMP_PREFIX_RE = /^antares-(?:backend-command|pdf|staged)-/;

// Referencias a los métodos ORIGINALES antes de instalar el tee: evita
// recursión y garantiza salida a consola aunque el archivo de log falle.
const _originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let _logsDir = null;
let _logsDirReady = false;
let _consoleTeeInstalled = false;

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

function _todayLogPath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(getLogsDir(), `antares-${yyyy}-${mm}-${dd}.log`);
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

/** Ruta del log de hoy, sin seguir symlinks (hardening anti-escritura arbitraria). */
function _safeLogPath() {
  const p = _todayLogPath();
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) {
      // Nunca escribir a través de un link: eliminar el link y recrear plano.
      fs.unlinkSync(p);
    }
  } catch {
    // No existe — se creará al abrir.
  }
  return p;
}

/** Append best-effort a <dataDir>/logs/antares-YYYY-MM-DD.log. Nunca lanza. */
function appendLogLine(level, text) {
  try {
    if (!_logsDirReady) {
      fs.mkdirSync(getLogsDir(), { recursive: true });
      _logsDirReady = true;
    }
    // Sanitiza saltos de línea: strings de IPC (métodos, rutas) podrían
    // inyectar líneas falsas en el log (log forging).
    const safeText = String(text).replace(/[\r\n]+/g, ' ');
    const line = `[${new Date().toISOString()}] [${level}] ${safeText}\n`;
    fs.appendFileSync(_safeLogPath(), line, 'utf8');
  } catch {
    _logsDirReady = false; // reintenta el mkdir en la siguiente llamada
  }
}

/** Garantiza <dataDir>/logs y rota: borra diarios más viejos que LOG_RETENTION_DAYS. */
function initAppLogs() {
  const dir = getLogsDir();
  fs.mkdirSync(dir, { recursive: true });
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('antares-') || !name.endsWith('.log')) continue;
      try {
        if (fs.statSync(path.join(dir, name)).mtimeMs < cutoff) {
          fs.unlinkSync(path.join(dir, name));
        }
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return dir;
}

/**
 * Redirige console.warn/error (y console.log solo con ANTARES_IPC_TELEMETRY=1)
 * a consola + archivo de log. Así la telemetría IPC y los warnings del proceso
 * principal quedan persistidos sin tocar cada punto de emisión.
 */
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

/** ¿Existe un proceso con este pid? (usado para no borrar staging de otra instancia viva). */
function _isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = el proceso existe pero no tenemos permiso para señalarle.
    return err && err.code === 'EPERM';
  }
}

/** Máximo mtime del CONTENIDO del directorio (los writes internos no tocan el mtime del dir). */
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

/**
 * Elimina residuos temporales huérfanos de sesiones previas
 * (p.ej. %TEMP%\antares-backend-command-* creados por tests) con más de 24 h.
 * Devuelve cuántos directorios eliminó.
 *
 * Seguridad: nunca borra el staging de un proceso VIVO (antares-staged-<pid>)
 * ni directorios con contenido reciente — el mtime del dir no refleja los
 * writes internos (appendStagedChunk escribe dentro sin tocar el dir), así que
 * un import de Excel o un render PDF en curso jamás se trunca por esta limpieza.
 */
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
        // Staging de otra instancia viva: el dir se llama antares-staged-<pid>.
        const pidMatch = /^antares-staged-(\d+)$/.exec(name);
        if (pidMatch && _isProcessAlive(Number(pidMatch[1]))) continue;
        // Contenido reciente (archivo .tmp en staging, render.html en PDF) => en uso.
        if (_dirContentMaxMtime(p) >= cutoff) continue;
        fs.rmSync(p, { recursive: true, force: true });
        removed += 1;
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return removed;
}

module.exports = {
  appendLogLine,
  cleanStaleTempDirs,
  getLogsDir,
  initAppLogs,
  installConsoleLogTee,
  resolveAppDataDir,
};
