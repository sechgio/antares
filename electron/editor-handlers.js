// Handlers nativos del editor: diálogo de importación de medios.
//
// Contrato (plan §5): `editor_import_files` entrega tokens de lectura
// emitidos por el diálogo aprobado; el renderer nunca envía rutas
// arbitrarias. Los filtros limitan la selección a formatos de medios
// y el backend valida de nuevo el token al copiar.

const path = require('path');

const { registerAllowedReadPaths } = require('./path-allowlist');
const { createFileCapabilityAsync } = require('./file-capabilities');

const MEDIA_FILTERS = [
  {
    name: 'Vídeos',
    extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'],
  },
  {
    name: 'Audio',
    extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  },
  {
    name: 'Imágenes',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  },
];

const EDITOR_METHODS = new Set(['editor_import_files']);

async function _createReadTokens(filePaths, window) {
  const webContentsId = window && window.webContents ? window.webContents.id : null;
  const tokens = [];
  for (const filePath of filePaths) {
    const cap = await createFileCapabilityAsync({
      filePath,
      mode: 'read',
      webContentsId,
      name: path.basename(filePath),
    });
    tokens.push(cap.token);
  }
  return tokens;
}

async function runEditorImportFiles(params = {}, dialog, window) {
  const response = await dialog.showOpenDialog(window, {
    title: (params && params.title) || 'Importar archivos al editor',
    properties: ['openFile', 'multiSelections'],
    filters: MEDIA_FILTERS,
  });
  if (response.canceled || !response.filePaths || response.filePaths.length === 0) {
    return { paths: [], file_tokens: [] };
  }
  const files = response.filePaths;
  registerAllowedReadPaths(files);
  return {
    paths: files.map((p) => path.basename(p)),
    file_tokens: await _createReadTokens(files, window),
  };
}

async function handleEditorCall(method, params = {}, dialog, window) {
  if (!EDITOR_METHODS.has(method)) {
    return { handled: false };
  }
  return { handled: true, result: await runEditorImportFiles(params, dialog, window) };
}

module.exports = {
  MEDIA_FILTERS,
  runEditorImportFiles,
  handleEditorCall,
};
