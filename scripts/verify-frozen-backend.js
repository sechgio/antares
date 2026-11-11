const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// secrets-012: paridad con cua-driver/media — el bundle congelado del backend
// viaja con un manifiesto de hashes SHA-256 (uno por archivo del onedir). Se
// genera al terminar el build y se re-verifica antes de empaquetar.
const BACKEND_MANIFEST_NAME = 'antares-backend-manifest.json';
const MAX_MANIFEST_FILES = 4096;
const MAX_BUNDLE_GB = 2;

function isUnsafeManifestPath(rel) {
  return typeof rel !== 'string' || !rel || rel.includes('..') || path.isAbsolute(rel);
}

function computeBackendManifest(dir) {
  let totalBytes = 0;
  const binaries = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath || entry.path, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join('/');
    if (rel === BACKEND_MANIFEST_NAME || isUnsafeManifestPath(rel)) continue;
    const buffer = fs.readFileSync(abs);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BUNDLE_GB * 1024 * 1024 * 1024) {
      throw new Error('El bundle del backend excede el techo de 2 GB para el manifiesto');
    }
    binaries.push({
      path: rel,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      byteSize: buffer.length,
    });
    if (binaries.length > MAX_MANIFEST_FILES) {
      throw new Error(`El bundle del backend supera ${MAX_MANIFEST_FILES} archivos en el manifiesto`);
    }
  }
  binaries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 1,
    description: 'Backend congelado (PyInstaller onedir): huella SHA-256 y tamaño de cada archivo. Regenerado por scripts/build-backend.js y re-verificado antes de empaquetar.',
    binaries,
  };
}

function writeBackendManifest(dir) {
  const manifest = computeBackendManifest(dir);
  fs.writeFileSync(
    path.join(dir, BACKEND_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

function assertBackendManifest(dir) {
  const manifestPath = path.join(dir, BACKEND_MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `El backend empaquetado no trae ${BACKEND_MANIFEST_NAME}; vuelve a ejecutar npm run build:backend`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Manifiesto del backend ilegible: ${error.message}`);
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.binaries) || manifest.binaries.length === 0) {
    throw new Error('Manifiesto del backend inválido');
  }
  for (const bin of manifest.binaries) {
    if (isUnsafeManifestPath(bin.path)) {
      throw new Error(`Ruta inválida en el manifiesto del backend: ${JSON.stringify(bin.path)}`);
    }
    const file = path.join(dir, ...bin.path.split('/'));
    if (!fs.existsSync(file)) {
      throw new Error(`El manifiesto del backend lista un archivo ausente: ${bin.path}`);
    }
    const buffer = fs.readFileSync(file);
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    if (digest !== bin.sha256 || buffer.length !== bin.byteSize) {
      throw new Error(
        `El backend empaquetado no coincide con su manifiesto: ${bin.path}`,
      );
    }
  }
  return manifest;
}

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
  'spreadsheet_export_volantes_template',
  'editor_bootstrap',
  'editor_export_start',
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
    let renderPreview = null;
    let editorJobId = null;
    let editorStartedAt = 0;
    let pollTimer = null;

    const sendRequest = (id, method, params) => {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
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
          renderPreview = {
            mimeType: result.mime_type,
            width: result.rendered_width,
            height: result.rendered_height,
          };
          sendRequest('volantes-template', 'spreadsheet_export_volantes_template', {});
          continue;
        }
        if (msg.id === 'volantes-template') {
          const result = msg.result;
          if (
            msg.error
            || !result
            || typeof result.content_b64 !== 'string'
            || !result.content_b64.startsWith('UEsDB')
          ) {
            finish(new Error(
              `spreadsheet_export_volantes_template smoke failed (pandas/openpyxl import chain): ` +
              `${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          editorSmoke = { stage: 'bootstrap' };
          sendRequest('editor-bootstrap', 'editor_bootstrap', {});
          continue;
        }
        if (msg.id === 'editor-bootstrap') {
          const result = msg.result;
          if (msg.error || !result || !Array.isArray(result.projects)) {
            finish(new Error(
              `editor_bootstrap smoke failed: ${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          sendRequest('editor-export', 'editor_export_start', {
            document: {
              id: 'smoke',
              schemaVersion: 1,
              name: 'Smoke',
              revision: 1,
              canvas: { width: 320, height: 240, background: '#000000' },
              assets: [],
              tracks: [{ id: 't1', kind: 'video', order: 0 }],
              clips: [],
              exportSettings: { format: 'mp4', width: 320, height: 240, fps: 25 },
            },
            outputPath: path.join(smokePdf.directory, 'editor-smoke-ñ.mp4'),
          });
          continue;
        }
        if (msg.id === 'editor-export') {
          const result = msg.result;
          if (msg.error || !result || !result.started || !result.jobId) {
            finish(new Error(
              `editor_export_start smoke failed: ${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          editorJobId = result.jobId;
          editorStartedAt = Date.now();
          const poll = () => {
            sendRequest('editor-job', 'editor_job_status', { jobId: editorJobId });
          };
          pollTimer = setInterval(poll, 1000);
          poll();
          continue;
        }
        if (msg.id === 'editor-job') {
          const result = msg.result;
          if (msg.error || !result) {
            finish(new Error(
              `editor_job_status smoke failed: ${JSON.stringify(msg.error || result || null)}`,
            ));
            return;
          }
          if (result.running) {
            if (Date.now() - editorStartedAt > 120_000) {
              finish(new Error('editor export job smoke timed out after 120s'));
            }
            return;
          }
          clearInterval(pollTimer);
          pollTimer = null;
          const output = path.join(smokePdf.directory, 'editor-smoke-ñ.mp4');
          if (!fs.existsSync(output)) {
            finish(new Error(
              `editor export smoke no produjo salida: ${JSON.stringify(result)}`,
            ));
            return;
          }
          console.log(
            `[build-backend] Post-build smoke OK: templates_list=${templateCount} ` +
            `canvas_list=ok sellador_render_page=ok volantes_template=pandas+openpyxl ` +
            `editor_bootstrap=ok editor_export=ok (${fs.statSync(output).size} bytes)`,
          );
          finish(null, {
            count: templateCount,
            preview: renderPreview,
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

module.exports = { verifyFrozenBackendTemplates, computeBackendManifest, writeBackendManifest, assertBackendManifest };
