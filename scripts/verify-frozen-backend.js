const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function frozenBackendEnv() {
  return {
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
}

async function createSelladorSmokePdf() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-backend-smoke-'));
  const file = path.join(directory, 'sellador-preview.pdf');
  try {
    const document = await PDFDocument.create();
    document.addPage([72, 72]);
    await fs.promises.writeFile(file, await document.save());
    return { directory, file };
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const SMOKE_METHODS = [
  'templates_list',
  'canvas_list',
  'sellador_inspect_pdf',
  'sellador_render_page',
];

function assertSmokeMethodsInCatalog() {
  const catalog = require('../shared/ipc-method-catalog');
  for (const method of SMOKE_METHODS) {
    if (!catalog.BACKEND_METHODS.includes(method)) {
      throw new Error(
        `Método smoke '${method}' no está declarado como backend: en shared/ipc-method-catalog.json`,
      );
    }
  }
}

async function verifyFrozenBackendTemplates(exePath, options = {}) {
  assertSmokeMethodsInCatalog();
  const timeoutMs = options.timeoutMs || 90_000;
  const minTemplates = options.minTemplates || 5;
  const smokePdf = await createSelladorSmokePdf();

  try {
    return await new Promise((resolve, reject) => {
    const env = {
      ...frozenBackendEnv(),
      LOCALAPPDATA: smokePdf.directory,
      APPDATA: smokePdf.directory,
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
    let templateCount = 0;

    const sendRequest = (id, method, params) => {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const done = () => (err ? reject(err) : resolve(result));
      if (proc.exitCode !== null || proc.signalCode !== null) {
        done();
        return;
      }
      // En Windows el hijo puede seguir reteniendo archivos (p. ej. el WAL de
      // SQLite del smoke dir) unos ms tras kill(); esperar a 'close' evita
      // EBUSY al limpiar smokePdf.directory en el finally.
      const killTimer = setTimeout(done, 5_000);
      proc.once('close', () => {
        clearTimeout(killTimer);
        done();
      });
      try {
        proc.kill();
      } catch {
        clearTimeout(killTimer);
        done();
      }
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
          sendRequest('templates', 'templates_list', {});
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
          templateCount = templates.length;
          sendRequest('canvas-list', 'canvas_list', {});
          continue;
        }
        if (msg.id === 'canvas-list') {
          const documents = msg.result && msg.result.documents;
          if (msg.error || !Array.isArray(documents)) {
            finish(new Error(
              `canvas_list smoke failed: ${JSON.stringify(msg.error || msg.result || null)}`,
            ));
            return;
          }
          sendRequest('sellador-inspect', 'sellador_inspect_pdf', { pdf_path: smokePdf.file });
          continue;
        }
        if (msg.id === 'sellador-inspect') {
          const result = msg.result;
          if (
            msg.error
            || !result
            || result.page_count !== 1
            || result.page_width !== 72
            || result.page_height !== 72
          ) {
            finish(new Error(
              `sellador_inspect_pdf smoke failed: ${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          sendRequest('sellador-render', 'sellador_render_page', {
            pdf_path: smokePdf.file,
            page_num: 1,
            max_width: 640,
          });
          continue;
        }
        if (msg.id === 'sellador-render') {
          const result = msg.result;
          if (
            msg.error
            || !result
            || result.mime_type !== 'image/jpeg'
            || typeof result.image_base64 !== 'string'
            || result.image_base64.length === 0
            || Number(result.rendered_width) <= 0
            || Number(result.rendered_height) <= 0
          ) {
            finish(new Error(
              `sellador_render_page smoke failed: ${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          console.log(
            `[build-backend] Post-build smoke OK: templates_list=${templateCount} ` +
            `canvas_list=ok sellador_render_page=${result.mime_type}`,
          );
          finish(null, {
            count: templateCount,
            preview: {
              mimeType: result.mime_type,
              width: result.rendered_width,
              height: result.rendered_height,
            },
          });
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
  } finally {
    await fs.promises.rm(smokePdf.directory, { recursive: true, force: true });
  }
}

module.exports = { frozenBackendEnv, verifyFrozenBackendTemplates };
