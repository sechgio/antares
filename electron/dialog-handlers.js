const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { sanitizeHtmlForPdf } = require('../shared/html-sanitizer');
const { createLocalThumbnail, createLocalImageDataUrl } = require('./local-thumbnail');
const {
  isPathInside,
  registerAllowedReadPath,
  registerAllowedReadPaths,
  assertPathNotSymlink,
  isAllowedReadPath,
} = require('./path-allowlist');
const {
  resolveCapability,
  revokeCapability,
  createFileCapability,
  createStagedSession,
  appendStagedChunk,
  completeStagedSession,
  abortStagedSession,
} = require('./file-capabilities');
const { putCanvasAsset, getCanvasAsset, parseAssetRef, gcOrphanCanvasAssets } = require('./canvas-assets');
const { cleanupSpreadsheetSpillFile, sweepIpcTempDirs } = require('./ipc-temp-cleanup');

// Single source of truth: electron/ipc-methods.js exports the native-method
// allowlist. This authoritative guard derives from it — adding a native
// method is one edit in ipc-methods.js, never an inline copy here.
const NATIVE_METHODS = new Set(require('./ipc-methods').NATIVE_METHODS);

const REGISTER_LOCAL_PATH_DEPRECATED_MSG = 'register_local_path is deprecated; use file tokens via dialog or staged upload';

/** @type {Set<string>} Directory roots allowed for PDF writes (from dialogs). */
const _allowedWriteRoots = new Set();
// Persisted across sessions so an output folder chosen via native dialog keeps
// working after an app restart (raw paths are rejected unless under a root).
const WRITE_ROOTS_FILE = 'antares-write-roots.json';

function _persistedWriteRootsPath() {
  try {
    const { app } = require('electron');
    const userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
    return userData ? path.join(userData, WRITE_ROOTS_FILE) : null;
  } catch {
    return null;
  }
}

/** Best-effort: failing to persist must never break folder selection. */
function _persistWriteRoots() {
  const file = _persistedWriteRootsPath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([..._allowedWriteRoots], null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function _loadPersistedWriteRoots() {
  const file = _persistedWriteRootsPath();
  if (!file) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (typeof entry === 'string' && entry.trim()) _allowedWriteRoots.add(path.resolve(entry));
    }
  } catch {
    // No file yet, or corrupted: start with session roots only.
  }
}

function _registerWriteRootFromPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return;
  const resolved = path.resolve(rawPath);
  let root;
  try {
    const stat = fs.lstatSync(resolved);
    root = stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    root = path.dirname(resolved);
  }
  const sizeBefore = _allowedWriteRoots.size;
  _allowedWriteRoots.add(root);
  if (_allowedWriteRoots.size > sizeBefore) _persistWriteRoots();
}

function _registerDialogPaths(paths) {
  if (!Array.isArray(paths)) return;
  registerAllowedReadPaths(paths);
  for (const p of paths) _registerWriteRootFromPath(p);
}

function _isUnderAllowedPdfWriteDir(dir) {
  const resolvedDir = path.resolve(dir);
  for (const root of _allowedWriteRoots) {
    if (isPathInside(root, resolvedDir)) return true;
  }
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      for (const name of ['documents', 'downloads']) {
        const stdRoot = app.getPath(name);
        if (stdRoot && isPathInside(stdRoot, resolvedDir)) return true;
      }
    }
  } catch {
    /* Electron not available (unit tests) */
  }
  return false;
}

function _localImageEntries(rawPaths) {
  if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) return [];
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.ico']);

  return Object.entries(rawPaths).flatMap(([token, rawPath]) => {
    if (typeof token !== 'string' || !/^antares-local-image:[a-zA-Z0-9_-]{1,120}$/.test(token)) return [];

    let resolvedPath = rawPath;
    const isCapabilityToken = typeof rawPath === 'string' && rawPath.startsWith('antares-');
    if (isCapabilityToken) {
      try {
        resolvedPath = resolveCapability(rawPath, 'read', null).path;
      } catch {
        return [];
      }
    } else if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath) || !isAllowedReadPath(rawPath)) {
      return [];
    }

    if (typeof resolvedPath !== 'string' || !path.isAbsolute(resolvedPath)) return [];
    if (!allowedExtensions.has(path.extname(resolvedPath).toLowerCase())) return [];
    return [{ token, fileUrl: pathToFileURL(resolvedPath).toString() }];
  });
}

function _injectLocalImageUrls(html, localImages) {
  return localImages.reduce((current, entry) => current.split(entry.token).join(entry.fileUrl), html);
}

function _sanitizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return 'reporte.pdf';
  // Extract just the basename (no path components)
  const base = path.basename(name);
  // Remove characters invalid on Windows and prevent traversal
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  // Ensure .pdf extension
  if (!safe.toLowerCase().endsWith('.pdf')) return safe + '.pdf';
  return safe || 'reporte.pdf';
}

function _sanitizePdfOutputPath(outputPath, fallbackFilename) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) return null;
  const resolved = path.resolve(outputPath);
  const dir = path.dirname(resolved);
  if (!_isUnderAllowedPdfWriteDir(dir)) {
    throw new Error(
      'La ruta de salida del PDF no está permitida. Elige una carpeta con el diálogo de guardado o usa Documentos/Descargas.',
    );
  }
  const safeName = _sanitizeFilename(path.basename(resolved) || fallbackFilename);
  return path.join(dir, safeName);
}

function _handleRegisterLocalPath() {
  throw new Error(REGISTER_LOCAL_PATH_DEPRECATED_MSG);
}

function _resolveTokenPath(token, webContentsId) {
  const cap = resolveCapability(token, 'read', webContentsId ?? null);
  return cap.path;
}

function resultFromOpenDialog(response) {
  if (response.canceled) return { paths: [] };
  return { paths: response.filePaths || [] };
}

function resultFromSaveDialog(response) {
  if (response.canceled || !response.filePath) return { paths: [] };
  return { paths: [response.filePath] };
}

const FOLDER_SCAN_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp', '.gif', '.ico', '.pdf',
  '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg',
]);

const FOLDER_SCAN_CONCURRENCY = 8;

async function _scanFolderRecursive(dirPath, extensions) {
  const results = [];
  const pending = [dirPath];
  let active = 0;
  await new Promise((resolve) => {
    const schedule = () => {
      while (active < FOLDER_SCAN_CONCURRENCY && pending.length > 0) {
        const dir = pending.shift();
        active++;
        _scanOneDir(dir, extensions, results, pending).finally(() => {
          active--;
          if (pending.length === 0 && active === 0) resolve();
          else schedule();
        });
      }
      if (pending.length === 0 && active === 0) resolve();
    };
    schedule();
  });
  return results;
}

async function _scanOneDir(dirPath, extensions, results, pending) {
  let dir;
  try {
    dir = await fs.promises.opendir(dirPath);
  } catch {
    return;
  }
  try {
    for await (const entry of dir) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.has(ext)) results.push(fullPath);
      }
    }
  } catch {
    // ignore read errors mid-iteration
  }
}

// Pool persistente de ventanas ocultas para printToPDF. Cada slot tiene su
// propia partición de sesión (los interceptores webRequest son POR-SESIÓN: dos
// renders concurrentes en la misma partición pisarían sus allowlists) y su
// propia cola — hasta PDF_RENDER_SLOTS renders en paralelo sin pagar el
// spin-up de new BrowserWindow (~0.5-1.5 s) en cada render.
const PDF_RENDER_SLOTS = 2;
const pdfRenderSlots = Array.from({ length: PDF_RENDER_SLOTS }, (_, i) => ({
  queue: Promise.resolve(),
  window: null,
  session: null,
  partition: `pdf-render-${i}`,
}));
let pdfSlotCursor = 0;

function _nextPdfSlot() {
  const slot = pdfRenderSlots[pdfSlotCursor % PDF_RENDER_SLOTS];
  pdfSlotCursor += 1;
  return slot;
}

function renderHtmlToPdf(params = {}, electronModules = {}) {
  const slot = _nextPdfSlot();
  const render = () => _renderHtmlToPdf(params, electronModules, slot);
  const result = slot.queue.then(render, render);
  slot.queue = result.then(() => undefined, () => undefined);
  return result;
}

function _resetPdfRenderPool() {
  for (const slot of pdfRenderSlots) {
    slot.queue = Promise.resolve();
    slot.window = null;
    slot.session = null;
  }
  pdfSlotCursor = 0;
}

async function _renderHtmlToPdf(params = {}, electronModules = {}, slot) {
  const html = typeof params.html === 'string' ? params.html : '';
  if (!html.trim()) {
    throw new Error('HTML requerido para generar PDF');
  }

  const localImages = _localImageEntries(params.localImagePaths);
  const allowedFileUrls = new Set(localImages.map(entry => entry.fileUrl));

  const MAX_HTML_BYTES = 150 * 1024 * 1024; // 150 MB
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('HTML excede el tamaño máximo permitido (150 MB)');
  }

  // Sanitize BEFORE injecting allowlisted file:// URLs. The sanitizer strips
  // file: from src/href (defense-in-depth against arbitrary local reads);
  // tokens like antares-local-image:* survive sanitization, then we expand
  // only registered paths into file:// for printToPDF.
  const sanitizedHtml = sanitizeHtmlForPdf(html);
  const htmlWithLocalImages = _injectLocalImageUrls(sanitizedHtml, localImages);

  const { BrowserWindow, session } = electronModules;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow no disponible para generar PDF');
  }

  // Align with LONG_REQUEST_TIMEOUT_MS (15 min). A 60s hard cut aborted large
  // consolidations while the FE/IPC budget still had minutes left. The race
  // covers the WHOLE render (load, fonts, printToPDF): a window hung before
  // printToPDF (e.g. did-finish-load never fires) must not stall the shared
  // queue forever. `timeoutMs` is overridable for callers/tests with a tighter
  // budget.
  const PDF_TIMEOUT_MS = 900_000;
  const timeoutMs =
    Number.isFinite(params.timeoutMs) && params.timeoutMs > 0 ? params.timeoutMs : PDF_TIMEOUT_MS;
  let timeoutHandle = null;
  let timedOut = false;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error('Tiempo agotado generando el PDF'));
    }, timeoutMs);
  });

  let tempDir = null;
  let clearInterceptors = () => {};

  const renderBody = async () => {
    // Each slot owns a dedicated partition so webRequest interceptors never
    // collide across concurrent renders (they are session-scoped, not
    // window-scoped). The window itself is PERSISTED on the slot and reused:
    // only the first render per slot pays the BrowserWindow spin-up.
    const partitionName = slot.partition;
    let pdfSession = slot.session;
    if (!pdfSession && session && typeof session.fromPartition === 'function') {
      pdfSession = session.fromPartition(partitionName);
      slot.session = pdfSession;
    }

    let pdfWindow = slot.window;
    if (!pdfWindow || pdfWindow.isDestroyed()) {
      pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          ...(pdfSession ? { session: pdfSession } : {}),
        },
      });
      slot.window = pdfWindow;
    }

    // Block external resource loads to prevent SSRF and local file disclosure.
    // Cover http(s) AND file:// schemes — `*://*/*` does not match `file://`,
    // so we register a second filter for file URLs and only allow the
    // specific file:// URLs we whitelisted (the temp HTML + local images).
    clearInterceptors = () => {
      try {
        const targetSession = pdfSession || pdfWindow.webContents.session;
        if (targetSession && targetSession.webRequest) {
          targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, null);
          targetSession.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, null);
        }
      } catch {
        /* window/session already destroyed */
      }
    };

    if (pdfWindow.webContents.session && pdfWindow.webContents.session.webRequest) {
      const filter = (details, callback) => {
        const url = details.url || '';
        if (
          url.startsWith('data:')
          || allowedFileUrls.has(url)
          || url.startsWith('https://fonts.googleapis.com/')
          || url.startsWith('https://fonts.gstatic.com/')
        ) {
          callback({ cancel: false });
        } else {
          callback({ cancel: true });
        }
      };
      pdfWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, filter);
      pdfWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, filter);
    }

    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-pdf-'));
    const htmlPath = path.join(tempDir, 'render.html');
    const htmlUrl = pathToFileURL(htmlPath).toString();
    allowedFileUrls.add(htmlUrl);
    await fs.promises.writeFile(htmlPath, htmlWithLocalImages, 'utf8');

    const didFinishLoad = new Promise((resolve, reject) => {
      pdfWindow.webContents.once('did-finish-load', resolve);
      pdfWindow.webContents.once('did-fail-load', (_event, _code, description) => {
        reject(new Error(description || 'No se pudo cargar el HTML para PDF'));
      });
    });

    await pdfWindow.loadFile(htmlPath);
    await didFinishLoad;

    // Wait for webfonts (Google Fonts) so printToPDF is not rasterized with fallbacks.
    try {
      await Promise.race([
        pdfWindow.webContents.executeJavaScript(
          'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
        ),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      /* fonts.ready unavailable — proceed with system fallbacks */
    }

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
    });
    const filename = _sanitizeFilename(params.filename) || 'reporte.pdf';
    let outputPath = _sanitizePdfOutputPath(params.outputPath, filename);

    if (!outputPath) {
      const autoDir = path.join(os.tmpdir(), 'antares-pdf-out');
      await fs.promises.mkdir(autoDir, { recursive: true });
      outputPath = path.join(autoDir, `${crypto.randomUUID()}_${filename}`);
    }

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, pdfBuffer);

    const cap = createFileCapability({
      filePath: outputPath,
      mode: 'read',
      webContentsId: null,
      name: path.basename(outputPath),
      size: pdfBuffer.length,
    });

    const result = {
      saved_path: outputPath,
      filename,
      file_token: cap.token,
    };

    const wantBase64 = params.return_base64 === true;
    if (wantBase64) {
      result.pdf_base64 = Buffer.from(pdfBuffer).toString('base64');
    }

    return result;
  };

  let renderFailed = false;

  try {
    return await Promise.race([renderBody(), timeoutPromise]);
  } catch (err) {
    renderFailed = true;
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    clearInterceptors();
    // Pool: la ventana se reutiliza SOLO tras un render OK. En timeout/error
    // se destruye (destroy() fuerza la cancelación: printToPDF se aborta con
    // el webContents, y un renderer colgado no responde a close()) y el slot
    // queda marcado para recrearla en el próximo uso.
    const win = slot.window;
    if (win && !win.isDestroyed()) {
      if (timedOut || renderFailed) {
        win.destroy();
        slot.window = null;
      }
    }
    // The per-slot partition is reused across renders — do NOT clear its
    // storage data so the HTTP cache (fonts) persists between calls.
    if (tempDir) {
      // Retry removal on Windows where EBUSY is common right after window close
      let attempts = 0;
      const tryRm = async () => {
        for (;;) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
            return;
          } catch (err) {
            attempts++;
            if (attempts >= 5 || err.code !== 'EBUSY') throw err;
            await new Promise(r => setTimeout(r, 200 * attempts));
          }
        }
      };
      await tryRm().catch(err => {
        console.warn('[dialog-handlers] Failed to clean temp dir after retries:', err.message);
      });
    }
  }
}

function _webContentsIdFromWindow(win) {
  try { return win && win.webContents ? win.webContents.id : null; } catch { return null; }
}

async function handleDialogCall(method, params = {}, dialog, window, electronModules = {}) {
  if (!NATIVE_METHODS.has(method)) {
    return { handled: false };
  }

  if (method === 'register_local_path') {
    return { handled: true, result: _handleRegisterLocalPath() };
  }

  if (method === 'file_token_resolve') {
    const token = params && params.token;
    const filePath = _resolveTokenPath(token, _webContentsIdFromWindow(window));
    return { handled: true, result: { path: filePath } };
  }

  if (method === 'file_token_read_json') {
    const token = params && params.token;
    const filePath = _resolveTokenPath(token, _webContentsIdFromWindow(window));
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const MAX_JSON_READ = 64 * 1024 * 1024;
    if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_READ) {
      throw new Error('El resultado JSON es demasiado grande para cargarlo en memoria');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } finally {
      // Spill files are one-shot; delete after read so %TEMP% does not grow unbounded.
      await cleanupSpreadsheetSpillFile(filePath);
      revokeCapability(token);
    }
    // Opportunistic sweep of stale PDF/spill temps (best-effort).
    void sweepIpcTempDirs();
    return { handled: true, result: parsed };
  }

  if (method === 'file_token_cleanup') {
    const token = params && params.token;
    if (!token || typeof token !== 'string') {
      return { handled: true, result: { cleaned: false } };
    }
    let filePath;
    try {
      filePath = _resolveTokenPath(token, _webContentsIdFromWindow(window));
    } catch {
      return { handled: true, result: { cleaned: false } };
    }
    await cleanupSpreadsheetSpillFile(filePath);
    revokeCapability(token);
    return { handled: true, result: { cleaned: true } };
  }

  if (method === 'file_staged_create') {
    const session = createStagedSession({ name: params.name, size: params.size, webContentsId: _webContentsIdFromWindow(window) });
    // Do not return tmpPath to the renderer — capability token is sufficient.
    return { handled: true, result: { token: session.token } };
  }

  if (method === 'file_staged_append') {
    // Prefer binary `chunk` (ArrayBuffer/Uint8Array); keep `chunk_b64` for older callers.
    const chunk = params.chunk !== undefined ? params.chunk : params.chunk_b64;
    const res = await appendStagedChunk(params.token, chunk, _webContentsIdFromWindow(window));
    return { handled: true, result: res };
  }

  if (method === 'file_staged_complete') {
    const cap = await completeStagedSession(params.token, _webContentsIdFromWindow(window));
    return { handled: true, result: { file_token: cap.token, name: cap.name, size: cap.size } };
  }

  if (method === 'file_staged_abort') {
    await abortStagedSession(params.token);
    return { handled: true, result: { aborted: true } };
  }

  if (method === 'canvas_asset_put') {
    const chunk = params.chunk !== undefined ? params.chunk : params.chunk_b64;
    const buf = typeof chunk === 'string'
      ? Buffer.from(chunk, 'base64')
      : chunk;
    const res = await putCanvasAsset(buf);
    return { handled: true, result: res };
  }

  if (method === 'canvas_asset_get') {
    const ref = params.ref || params.asset_id;
    if (!ref || (!parseAssetRef(ref) && typeof ref !== 'string')) {
      throw new Error('canvas asset ref required');
    }
    const buf = await getCanvasAsset(ref);
    // Return binary to renderer (structured clone) — no base64.
    return {
      handled: true,
      result: {
        ref: typeof ref === 'string' && ref.startsWith('canvas-asset:') ? ref : `canvas-asset:${ref}`,
        chunk: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        bytes: buf.length,
      },
    };
  }

  if (method === 'canvas_asset_gc') {
    const res = await gcOrphanCanvasAssets();
    return { handled: true, result: res };
  }

  if (method === 'local_thumbnail') {
    const { nativeImage } = electronModules;
    let resolvedPath = params && params.path;
    if (params && params.file_token) {
      resolvedPath = _resolveTokenPath(params.file_token, _webContentsIdFromWindow(window));
      // Capability tokens bypass dialog allowlist registration; grant read for this path.
      registerAllowedReadPath(resolvedPath);
    }
    const result = await createLocalThumbnail(
      resolvedPath,
      params && params.maxEdge,
      nativeImage,
    );
    return { handled: true, result };
  }

  if (method === 'local_image_data_url') {
    let resolvedPath = params && params.path;
    if (params && params.file_token) {
      resolvedPath = _resolveTokenPath(params.file_token, _webContentsIdFromWindow(window));
      registerAllowedReadPath(resolvedPath);
    }
    const result = await createLocalImageDataUrl(resolvedPath);
    return { handled: true, result };
  }

  if (method === 'html_to_pdf') {
    return { handled: true, result: await renderHtmlToPdf(params, electronModules) };
  }

  if (method === 'dialog_save') {
    const response = await dialog.showSaveDialog(window, {
      title: params.title || 'Guardar archivo',
      defaultPath: params.defaultPath,
      filters: params.filters || [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    const result = resultFromSaveDialog(response);
    _registerDialogPaths(result.paths);
    return { handled: true, result };
  }

  if (method === 'dialog_folder') {
    const response = await dialog.showOpenDialog(window, {
      title: params.title || 'Seleccionar carpeta',
      properties: ['openDirectory'],
    });
    if (response.canceled || !response.filePaths || response.filePaths.length === 0) {
      return { handled: true, result: { paths: [] } };
    }
    const folderPath = response.filePaths[0];
    // `pickOnly` returns just the folder path without scanning its contents.
    // Used by features that only need a destination (e.g. image optimizer
    // "save to folder"), so we avoid an expensive recursive scan.
    _registerWriteRootFromPath(folderPath);
    if (params && params.pickOnly) {
      return { handled: true, result: { paths: [], folder: folderPath } };
    }
    const files = await _scanFolderRecursive(folderPath, FOLDER_SCAN_EXTENSIONS);
    _registerDialogPaths(files);
    return { handled: true, result: { paths: files } };
  }

  const properties = method === 'dialog_dest'
    ? ['openDirectory']
    : ['openFile', 'multiSelections'];

  const response = await dialog.showOpenDialog(window, {
    title: params.title || (properties.includes('openDirectory') ? 'Seleccionar carpeta' : 'Seleccionar archivos'),
    properties,
    filters: params.filters || [
      { name: 'Archivos compatibles', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'ico', 'pdf', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg', 'xlsx', 'xls'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });

  const result = resultFromOpenDialog(response);
  if (method === 'dialog_dest' && result.paths.length > 0) {
    _registerWriteRootFromPath(result.paths[0]);
  }
  _registerDialogPaths(result.paths);
  return { handled: true, result };
}

// Folders approved via native dialogs survive restarts (raw output paths are
// only accepted under a registered root).
_loadPersistedWriteRoots();

module.exports = {
  handleDialogCall,
  NATIVE_METHODS,
  /** Write roots registered by native dialogs (dialog_folder/dialog_dest/dialog_save). */
  isUnderAllowedWriteRoot: (dir) => _isUnderAllowedPdfWriteDir(dir),
  _clearAllowedWriteRoots: () => _allowedWriteRoots.clear(),
  /** Test hook: reset the persistent PDF render pool (windows/sessions/queues). */
  _resetPdfRenderPool,
};
