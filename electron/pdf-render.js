const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { sanitizeHtmlForPdf } = require('../shared/html-sanitizer');
const { raceTimeout, sleep } = require('./async-utils');
const { isAllowedReadPath } = require('./path-allowlist');
const {
  resolveCapability,
  createFileCapability,
  cleanupStagedCapability,
} = require('./file-capabilities');
const { embedCanvasManifest } = require('./canvas-pdf-manifest');
const {
  _sanitizeFilename,
  _sanitizePdfOutputPath,
  _assertSafePdfOutputPath,
} = require('./write-roots');

function _localImageEntries(rawPaths, webContentsId = null) {
  if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) return [];
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.ico']);

  return Object.entries(rawPaths).flatMap(([token, rawPath]) => {
    if (typeof token !== 'string' || !/^antares-local-image:[a-zA-Z0-9_-]{1,120}$/.test(token)) return [];

    let resolvedPath = rawPath;
    const isCapabilityToken = typeof rawPath === 'string' && rawPath.startsWith('antares-');
    if (isCapabilityToken) {
      try {
        resolvedPath = resolveCapability(rawPath, 'read', webContentsId).path;
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

async function _cleanupStagedImageCapabilities(rawPaths, webContentsId = null) {
  if (!rawPaths || typeof rawPaths !== 'object' || Array.isArray(rawPaths)) return;
  const tokens = new Set(
    Object.values(rawPaths).filter(
      (value) => typeof value === 'string' && value.startsWith('antares-read_'),
    ),
  );
  await Promise.all([...tokens].map((token) => cleanupStagedCapability(token, webContentsId)));
}

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

function renderHtmlToPdf(params = {}, electronModules = {}, webContentsId = null) {
  const slot = _nextPdfSlot();
  const render = () => _renderHtmlToPdf(params, electronModules, slot, webContentsId);
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

async function _renderHtmlToPdf(params = {}, electronModules = {}, slot, webContentsId = null) {
  const html = typeof params.html === 'string' ? params.html : '';
  if (!html.trim()) {
    throw new Error('HTML requerido para generar PDF');
  }

  const localImages = _localImageEntries(params.localImagePaths, webContentsId);
  const allowedFileUrls = new Set(localImages.map(entry => entry.fileUrl));

  const MAX_HTML_BYTES = 150 * 1024 * 1024;
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('HTML excede el tamaño máximo permitido (150 MB)');
  }
  const sanitizedHtml = sanitizeHtmlForPdf(html);
  const htmlWithLocalImages = localImages.reduce((current, entry) => current.split(entry.token).join(entry.fileUrl), sanitizedHtml);

  const { BrowserWindow, session } = electronModules;
  if (!BrowserWindow) {
    throw new Error('BrowserWindow no disponible para generar PDF');
  }

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

    clearInterceptors = () => {
      try {
        const targetSession = pdfSession || pdfWindow.webContents.session;
        if (targetSession && targetSession.webRequest) {
          targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, null);
        }
      } catch {
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
      // webRequest keeps a single listener per event: a second registration
      // would replace this one, so the filter itself covers every scheme.
      pdfWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, filter);
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

    try {
      await raceTimeout(
        pdfWindow.webContents.executeJavaScript(
          'document.fonts && document.fonts.status === "loaded" ? true : (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true)',
        ),
        1500,
        () => {},
      );
    } catch {
    }

    let pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
    });

    if (params.canvas_manifest_b64) {
      pdfBuffer = await embedCanvasManifest(pdfBuffer, params.canvas_manifest_b64);
    }

    if (typeof pdfWindow.loadURL === 'function') {
      try {
        await pdfWindow.loadURL('about:blank');
      } catch {
        if (!pdfWindow.isDestroyed()) {
          pdfWindow.destroy();
          slot.window = null;
        }
      }
    }

    const filename = _sanitizeFilename(params.filename) || 'reporte.pdf';
    let outputPath = _sanitizePdfOutputPath(params.outputPath, filename);

    if (!outputPath) {
      const autoDir = path.join(os.tmpdir(), 'antares-pdf-out');
      await fs.promises.mkdir(autoDir, { recursive: true });
      outputPath = path.join(autoDir, `${crypto.randomUUID()}_${filename}`);
    }

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    if (typeof params.outputPath === 'string' && params.outputPath.trim()) {
      _assertSafePdfOutputPath(outputPath);
    }
    await fs.promises.writeFile(outputPath, pdfBuffer);

    const cap = createFileCapability({
      filePath: outputPath,
      mode: 'read',
      webContentsId,
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
  const bodyPromise = renderBody();

  try {
    return await Promise.race([bodyPromise, timeoutPromise]);
  } catch (err) {
    renderFailed = true;
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    clearInterceptors();
    await _cleanupStagedImageCapabilities(params.localImagePaths, webContentsId);
    const win = slot.window;
    if (win && !win.isDestroyed()) {
      if (timedOut || renderFailed) {
        win.destroy();
        slot.window = null;
      }
    }
    if (timedOut || renderFailed) {
      // El cuerpo del render puede seguir dentro de loadFile/printToPDF: al
      // destruir la ventana esas llamadas rechazan; espera acotada a que el
      // body asiente antes de borrar el tempDir para no correr el cleanup en
      // paralelo con un render vivo.
      await raceTimeout(bodyPromise.catch(() => {}), 5_000, () => {});
    }
    if (tempDir) {
      let attempts = 0;
      const tryRm = async () => {
        for (;;) {
          try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
            return;
          } catch (err) {
            attempts++;
            if (attempts >= 5 || err.code !== 'EBUSY') throw err;
            await sleep(200 * attempts);
          }
        }
      };
      await tryRm().catch(err => {
        console.warn('[pdf-render] Failed to clean temp dir after retries:', err.message);
      });
    }
  }
}

module.exports = {
  renderHtmlToPdf,
  _resetPdfRenderPool,
};
