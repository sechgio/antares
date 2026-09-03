const { spawn } = require('child_process');

function verifyFrozenBackendTemplates(exePath, options = {}) {
  const timeoutMs = options.timeoutMs || 90_000;
  const minTemplates = options.minTemplates || 5;

  return new Promise((resolve, reject) => {
    const env = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      PATHEXT: process.env.PATHEXT,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    };

    const proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let ready = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      finish(new Error(
        `Frozen backend smoke timed out after ${timeoutMs / 1000}s.\nstderr:\n${stderr.slice(-1500)}`,
      ));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method === 'ready') {
          ready = true;
          proc.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: 'templates', method: 'templates_list', params: {} })}\n`,
          );
          continue;
        }
        if (msg.id === 'templates') {
          const templates = msg.result && Array.isArray(msg.result.templates) ? msg.result.templates : [];
          if (!ready) {
            finish(new Error('templates_list response before ready'));
            return;
          }
          if (templates.length < minTemplates) {
            finish(new Error(
              `templates_list returned ${templates.length} templates (expected >= ${minTemplates}). ` +
              `error=${JSON.stringify(msg.error || null)}`,
            ));
            return;
          }
          console.log(`[build-backend] Post-build smoke OK: templates_list=${templates.length}`);
          finish(null, { count: templates.length });
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => finish(err));
    proc.on('close', (code) => {
      if (!settled) {
        finish(new Error(`Frozen backend exited early (code=${code}). stderr:\n${stderr.slice(-1500)}`));
      }
    });
  });
}

module.exports = { verifyFrozenBackendTemplates };
