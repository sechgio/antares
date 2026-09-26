const fs = require('fs');
const path = require('path');

const { createLocalThumbnail, createLocalImageDataUrl } = require('./local-thumbnail');
const {
  registerAllowedReadPath,
  assertPathNotSymlink,
} = require('./path-allowlist');
const {
  resolveCapability,
  revokeCapability,
  createStagedSession,
  appendStagedChunk,
  completeStagedSession,
  abortStagedSession,
  cleanupStagedCapability,
} = require('./file-capabilities');
const {
  putCanvasAsset,
  getCanvasAsset,
  getCanvasAssetInfo,
  parseAssetRef,
} = require('./canvas-assets');
const { cleanupSpreadsheetSpillFile, sweepIpcTempDirs } = require('./ipc-temp-cleanup');
const writeRoots = require('./write-roots');
const { renderHtmlToPdf, _resetPdfRenderPool } = require('./pdf-render');
const { exportDiagnostics } = require('./diagnostics');
const {
  _webContentsIdFromWindow,
  runSaveDialog,
  runFolderDialog,
  runOpenDialog,
} = require('./file-dialogs');

const NATIVE_METHODS = new Set(require('../shared/ipc-method-catalog').NATIVE_METHODS);

function _resolveTokenPath(token, webContentsId) {
  const cap = resolveCapability(token, 'read', webContentsId ?? null);
  return cap.path;
}

function _resolveReadPathParam(params, webContentsId) {
  let resolvedPath = params && params.path;
  if (typeof resolvedPath === 'string' && resolvedPath.startsWith('antares-read_')) {
    resolvedPath = _resolveTokenPath(resolvedPath, webContentsId);
    registerAllowedReadPath(resolvedPath);
  }
  if (params && params.file_token) {
    resolvedPath = _resolveTokenPath(params.file_token, webContentsId);
    registerAllowedReadPath(resolvedPath);
  }
  return resolvedPath;
}

function registerFileInputPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0') || !path.isAbsolute(rawPath)) {
    return false;
  }
  try {
    const resolvedPath = path.resolve(rawPath);
    const stat = assertPathNotSymlink(resolvedPath);
    if (!stat.isFile()) return false;
    registerAllowedReadPath(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

async function handleDialogCall(method, params = {}, dialog, window, electronModules = {}) {
  if (!NATIVE_METHODS.has(method)) {
    return { handled: false };
  }
  const webContentsId = _webContentsIdFromWindow(window);

  if (method === 'file_token_read_json') {
    const token = params && params.token;
    const filePath = _resolveTokenPath(token, webContentsId);
    const MAX_JSON_READ = 64 * 1024 * 1024;
    let parsed;
    try {
      const st = await fs.promises.stat(filePath);
      if (!st.isFile()) {
        throw new Error('El resultado JSON no es un archivo regular');
      }
      if (st.size > MAX_JSON_READ) {
        throw new Error('El resultado JSON es demasiado grande para cargarlo en memoria');
      }
      const raw = await fs.promises.readFile(filePath, 'utf8');
      parsed = JSON.parse(raw);
    } finally {
      await cleanupSpreadsheetSpillFile(filePath);
      revokeCapability(token);
    }
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
      filePath = _resolveTokenPath(token, webContentsId);
    } catch {
      return { handled: true, result: { cleaned: false } };
    }
    await cleanupSpreadsheetSpillFile(filePath);
    await cleanupStagedCapability(token, webContentsId);
    revokeCapability(token);
    return { handled: true, result: { cleaned: true } };
  }

  if (method === 'file_staged_create') {
    const session = createStagedSession({ name: params.name, size: params.size, webContentsId: webContentsId });
    return { handled: true, result: { token: session.token } };
  }

  if (method === 'file_staged_append') {
    const chunk = params.chunk !== undefined ? params.chunk : params.chunk_b64;
    const res = await appendStagedChunk(params.token, chunk, webContentsId);
    return { handled: true, result: res };
  }

  if (method === 'file_staged_complete') {
    const cap = await completeStagedSession(params.token, webContentsId);
    return { handled: true, result: { file_token: cap.token, name: cap.name, size: cap.size } };
  }

  if (method === 'file_staged_abort') {
    await abortStagedSession(params.token, webContentsId);
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
    const assetId = parseAssetRef(ref) ?? ref;
    if (typeof assetId !== 'string' || !/^[a-f0-9]{32,128}$/i.test(assetId)) {
      throw new Error('canvas asset ref required');
    }
    const buf = await getCanvasAsset(ref);
    const chunk =
      buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
        ? buf.buffer
        : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      handled: true,
      result: {
        ref: typeof ref === 'string' && ref.startsWith('canvas-asset:') ? ref : `canvas-asset:${ref}`,
        chunk,
        bytes: buf.length,
      },
    };
  }

  if (method === 'canvas_asset_info') {
    const ref = params.ref || params.asset_id;
    const assetId = parseAssetRef(ref) ?? ref;
    if (typeof assetId !== 'string' || !/^[a-f0-9]{32,128}$/i.test(assetId)) {
      throw new Error('canvas asset ref required');
    }
    const res = await getCanvasAssetInfo(ref);
    return { handled: true, result: res };
  }

  if (method === 'local_thumbnail') {
    const { nativeImage } = electronModules;
    const resolvedPath = _resolveReadPathParam(params, webContentsId);
    const result = await createLocalThumbnail(
      resolvedPath,
      params && params.maxEdge,
      nativeImage,
    );
    return { handled: true, result };
  }

  if (method === 'local_image_data_url') {
    const resolvedPath = _resolveReadPathParam(params, webContentsId);
    const result = await createLocalImageDataUrl(resolvedPath);
    return { handled: true, result };
  }

  if (method === 'html_to_pdf') {
    return {
      handled: true,
      result: await renderHtmlToPdf(params, electronModules, webContentsId),
    };
  }

  if (method === 'logs_open_folder') {
    const { getLogsDir } = require('./app-log');
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    const shell = electronModules.shell || (() => {
      try {
        return require('electron').shell;
      } catch {
        return null;
      }
    })();
    if (shell && typeof shell.openPath === 'function') {
      const err = await shell.openPath(dir);
      if (err) {
        throw new Error(`No se pudo abrir la carpeta de registros: ${err}`);
      }
    }
    return { handled: true, result: { opened: true, path: dir } };
  }

  if (method === 'diagnostics_export') {
    return { handled: true, result: await exportDiagnostics(params, dialog, window) };
  }

  if (method === 'dialog_save') {
    return { handled: true, result: await runSaveDialog(params, dialog, window) };
  }

  if (method === 'dialog_folder') {
    return { handled: true, result: await runFolderDialog(params, dialog, window) };
  }

  return { handled: true, result: await runOpenDialog(method, params, dialog, window) };
}

writeRoots._clearAllowedWriteRoots();
writeRoots._loadPersistedWriteRoots();

module.exports = {
  handleDialogCall,
  NATIVE_METHODS,
  isUnderAllowedWriteRoot: writeRoots._isUnderRegisteredWriteRoot,
  _clearAllowedWriteRoots: writeRoots._clearAllowedWriteRoots,
  _resetPdfRenderPool,
  registerFileInputPath,
};
