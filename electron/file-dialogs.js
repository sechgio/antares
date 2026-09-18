const fs = require('fs');
const path = require('path');

const { registerAllowedReadPaths } = require('./path-allowlist');
const { createFileCapability } = require('./file-capabilities');
const { _registerWriteRootFromPath } = require('./write-roots');

function _webContentsIdFromWindow(win) {
  try { return win && win.webContents ? win.webContents.id : null; } catch { return null; }
}

function _createReadFileTokens(paths, window) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const webContentsId = _webContentsIdFromWindow(window);
  return paths.map((filePath) => createFileCapability({
    filePath,
    mode: 'read',
    webContentsId,
    name: path.basename(filePath),
  }).token);
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
  }
}

async function runSaveDialog(params = {}, dialog, window) {
  const response = await dialog.showSaveDialog(window, {
    title: params.title || 'Guardar archivo',
    defaultPath: params.defaultPath,
    filters: params.filters || [
      { name: 'Excel', extensions: ['xlsx'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  const result = resultFromSaveDialog(response);
  registerAllowedReadPaths(result.paths);
  _registerWriteRootFromPath(result.paths[0]);
  return result;
}

async function runFolderDialog(params = {}, dialog, window) {
  const response = await dialog.showOpenDialog(window, {
    title: params.title || 'Seleccionar carpeta',
    properties: ['openDirectory'],
  });
  if (response.canceled || !response.filePaths || response.filePaths.length === 0) {
    return { paths: [], file_tokens: [] };
  }
  const folderPath = response.filePaths[0];
  _registerWriteRootFromPath(folderPath);
  if (params && params.pickOnly) {
    return { paths: [], file_tokens: [], folder: folderPath };
  }
  const files = await _scanFolderRecursive(folderPath, FOLDER_SCAN_EXTENSIONS);
  registerAllowedReadPaths(files);
  return {
    paths: files,
    file_tokens: _createReadFileTokens(files, window),
  };
}

async function runOpenDialog(method, params = {}, dialog, window) {
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
  registerAllowedReadPaths(result.paths);
  return {
    ...result,
    file_tokens: method === 'dialog_dest' ? [] : _createReadFileTokens(result.paths, window),
  };
}

module.exports = {
  _webContentsIdFromWindow,
  _createReadFileTokens,
  resultFromOpenDialog,
  resultFromSaveDialog,
  runSaveDialog,
  runFolderDialog,
  runOpenDialog,
};
