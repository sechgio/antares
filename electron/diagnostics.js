const fs = require('fs');
const os = require('os');
const path = require('path');

const { _registerWriteRootFromPath } = require('./write-roots');

async function exportDiagnostics(params = {}, dialog, window) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultName = `antares-diagnostico-${today}.json`;
  const response = await dialog.showSaveDialog(window, {
    title: params.title || 'Exportar diagnóstico',
    defaultPath: params.defaultPath || defaultName,
    filters: params.filters || [
      { name: 'JSON', extensions: ['json'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (response.canceled || !response.filePath) {
    return { canceled: true, exported: false };
  }
  const outPath = response.filePath;
  const { getAppContext, getLogsDir, getDroppedEventCount, managedLogPattern, redactText } = require('./app-log');
  const { raceTimeout } = require('./async-utils');
  let backendInfo = {};
  try {
    const spawner = require('./backend-spawner');
    backendInfo = {
      state: typeof spawner.getState === 'function' ? spawner.getState() : 'unknown',
      health: typeof spawner.getHealthStatus === 'function' ? spawner.getHealthStatus() : null,
      last_error: typeof spawner.getLastError === 'function' ? spawner.getLastError() : null,
      stderr_tail: typeof spawner.getStderrTail === 'function' ? spawner.getStderrTail() : null,
      pending_requests: typeof spawner.getPendingRequestCount === 'function' ? spawner.getPendingRequestCount() : null,
    };
  } catch {
    backendInfo = { state: 'unreachable' };
  }

  let backendSnapshot = null;
  try {
    const spawner = require('./backend-spawner');
    if (typeof spawner.isReady === 'function' && spawner.isReady()) {
      backendSnapshot = await raceTimeout(
        require('./ipc-router')._callBackend('diagnostics_snapshot', {}),
        8_000,
        () => ({ error: 'snapshot_timeout' }),
      );
    } else {
      backendSnapshot = { skipped: 'backend_not_ready' };
    }
  } catch (err) {
    backendSnapshot = { error: redactText(err && err.message ? err.message : String(err)) };
  }

  const logsDir = getLogsDir();
  const recentLogs = [];
  try {
    if (fs.existsSync(logsDir)) {
      const files = fs.readdirSync(logsDir)
        .filter((f) => managedLogPattern.test(f))
        .map((f) => {
          const p = path.join(logsDir, f);
          return { name: f, path: p, mtimeMs: fs.statSync(p).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const file of files.slice(0, 2)) {
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          const lines = content.trim().split(/\r?\n/).slice(-200);
          for (const line of lines) {
            recentLogs.push({
              file: file.name,
              line: redactText(line),
            });
          }
        } catch {
        }
      }
    }
  } catch {
  }

  const payload = {
    exported_at: new Date().toISOString(),
    app: getAppContext ? getAppContext() : {},
    system: {
      platform: process.platform,
      arch: process.arch,
      os_release: os.release(),
      total_memory_mb: Math.round(os.totalmem() / 1048576),
      free_memory_mb: Math.round(os.freemem() / 1048576),
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
      electron_version: process.versions ? process.versions.electron : undefined,
    },
    backend: { ...backendInfo, snapshot: backendSnapshot },
    logs: { dropped_events: getDroppedEventCount() },
    recent_logs: recentLogs,
  };

  await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  _registerWriteRootFromPath(outPath);
  return { exported: true, path: outPath };
}

module.exports = { exportDiagnostics };
