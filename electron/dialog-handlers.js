const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { sanitizeHtmlForPdf } = require('../shared/html-sanitizer');

const DIALOG_METHODS = new Set(['dialog_files', 'dialog_dest', 'dialog_save', 'dialog_folder']);
const NATIVE_METHODS = new Set([...DIALOG_METHODS, 'html_to_pdf']);

function _localImageEntries(rawPaths) {
  if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) return [];
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.ico']);

  return Object.entries(rawPaths).flatMap(([token, rawPath]) => {
    if (typeof token !== 'string' || !/^antares-local-image:[a-zA-Z0-9_-]{1,120}$/.test(token)) return [];
    if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) return [];
    if (!allowedExtensions.has(path.extname(rawPath).toLowerCase())) return [];
    return [{ token, fileUrl: pathToFileURL(rawPath).toString() }];
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
  const safeName = _sanitizeFilename(path.basename(resolved) || fallbackFilename);
  return path.join(dir, safeName);
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

async function _scanFolderRecursive(dirPath, extensions) {
  const results = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await _scanFolderRecursive(fullPath, extensions);
      for (const p of sub) results.push(p);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

async function renderHtmlToPdf(params = {}, electronModules = {}) {
  const html = typeof params.html === 'string' ? params.html : '';
  if (!html.trim()) {
    throw new Error('HTML requerido para generar PDF');
  }

  const localImages = _localImageEntries(params.localImagePaths);
  const htmlWithLocalImages = _injectLocalImageUrls(html, localImages);
  const allowedFileUrls = new Set(localImages.map(entry => entry.fileUrl));

  const MAX_HTML_BYTES = 150 * 1024 * 1024; // 150 MB
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('HTML excede el tamaño máximo permitido (150 MB)');
  }

  const { BrowserWindow, session } = electronModules;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow no disponible para generar PDF');
  }

  // Use a dedicated session partition so the webRequest interceptor we
  // register below cannot leak into the main renderer's session (which
  // shares the default session and would lose network connectivity after
  // the first PDF render). A unique partition per call also means a stale
  // interceptor from a previous call cannot block this one.
  const partitionName = `pdf-render-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const pdfSession = (session && typeof session.fromPartition === 'function')
    ? session.fromPartition(partitionName)
    : null;

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(pdfSession ? { session: pdfSession } : {}),
    },
  });

  // Block external resource loads to prevent SSRF and local file disclosure.
  // Cover http(s) AND file:// schemes — `*://*/*` does not match `file://`,
  // so we register a second filter for file URLs and only allow the
  // specific file:// URLs we whitelisted (the temp HTML + local images).
  const clearInterceptors = () => {
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
      if (details.url.startsWith('data:') || allowedFileUrls.has(details.url)) {
        callback({ cancel: false });
      } else {
        callback({ cancel: true });
      }
    };
    pdfWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, filter);
    pdfWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, filter);
  }

  // Hard timeout: printToPDF can hang indefinitely on a malformed HTML or
  // a script that never settles. html_to_pdf is in LONG_RUNNING_METHODS but
  // the renderer still needs a bounded wait so the IPC doesn't sit forever.
  const PDF_TIMEOUT_MS = 60_000;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Tiempo agotado generando el PDF'));
    }, PDF_TIMEOUT_MS);
  });

  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'antares-pdf-'));
    const htmlPath = path.join(tempDir, 'render.html');
    const htmlUrl = pathToFileURL(htmlPath).toString();
    allowedFileUrls.add(htmlUrl);
    await fs.promises.writeFile(htmlPath, sanitizeHtmlForPdf(htmlWithLocalImages), 'utf8');

    const didFinishLoad = new Promise((resolve, reject) => {
      pdfWindow.webContents.once('did-finish-load', resolve);
      pdfWindow.webContents.once('did-fail-load', (_event, _code, description) => {
        reject(new Error(description || 'No se pudo cargar el HTML para PDF'));
      });
    });

    await pdfWindow.loadFile(htmlPath);
    await didFinishLoad;

    const pdfBuffer = await Promise.race([
      pdfWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'A4',
        margins: { marginType: 'none' },
      }),
      timeoutPromise,
    ]);
    const filename = _sanitizeFilename(params.filename) || 'reporte.pdf';
    const outputPath = _sanitizePdfOutputPath(params.outputPath, filename);

    if (outputPath) {
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, pdfBuffer);
      return {
        saved_path: outputPath,
        filename: path.basename(outputPath),
      };
    }

    const MAX_IPC_PDF_BYTES = 256 * 1024 * 1024;
    if (Buffer.byteLength(pdfBuffer) > MAX_IPC_PDF_BYTES) {
      throw new Error('El PDF generado es demasiado grande para devolverlo por IPC. Guarda el PDF directamente en disco.');
    }

    return {
      pdf_base64: Buffer.from(pdfBuffer).toString('base64'),
      filename,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    clearInterceptors();
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
    // Best-effort cleanup of the partition's storage so partitions don't
    // accumulate across calls. Errors here are harmless — the partition is
    // unique per call and will be reaped by Electron when the process exits.
    if (pdfSession) {
      try { await pdfSession.clearStorageData(); } catch { /* noop */ }
    }
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

async function handleDialogCall(method, params = {}, dialog, window, electronModules = {}) {
  if (!NATIVE_METHODS.has(method)) {
    return { handled: false };
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
    return { handled: true, result: resultFromSaveDialog(response) };
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
    if (params && params.pickOnly) {
      return { handled: true, result: { paths: [], folder: folderPath } };
    }
    const files = await _scanFolderRecursive(folderPath, FOLDER_SCAN_EXTENSIONS);
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

  return { handled: true, result: resultFromOpenDialog(response) };
}

module.exports = { handleDialogCall };
