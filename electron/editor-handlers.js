// Handlers nativos del editor: diálogo de importación de medios.
//
// Contrato (plan §5): `editor_import_files` entrega tokens de lectura
// emitidos por el diálogo aprobado; el renderer nunca envía rutas
// arbitrarias. Los filtros limitan la selección a formatos de medios
// y el backend valida de nuevo el token al copiar.

const fs = require('fs');
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

const EDITOR_METHODS = new Set([
  'editor_import_files',
  'editor_recording_create',
  'editor_recording_append',
  'editor_recording_finish',
  'editor_recording_abort',
]);

let _recordingManagerInstance = null;
const _recordingTokens = new Map();

function _recordingsDir() {
  const { app } = require('electron');
  const base = app ? app.getPath('userData') : require('os').tmpdir();
  const dir = path.join(base, 'editor', 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _recordingManager() {
  if (!_recordingManagerInstance) {
    const { RecordingSessionManager } = require('./editor-recorder');
    _recordingManagerInstance = new RecordingSessionManager({ directory: _recordingsDir() });
  }
  return _recordingManagerInstance;
}

async function runEditorRecording(method, params = {}, window) {
  const manager = _recordingManager();
  const sessionId = String(params.sessionId || '');
  if (method === 'editor_recording_create') {
    const session = manager.create(sessionId);
    return { sessionId: session.sessionId, maxInFlightBytes: manager.maxInFlightBytes };
  }
  if (method === 'editor_recording_append') {
    const chunk = Buffer.from(String(params.chunkB64 || ''), 'base64');
    return manager.get(sessionId).append(Number(params.seq), chunk);
  }
  if (method === 'editor_recording_finish') {
    const result = manager.finish(sessionId);
    // La grabación terminada se publica como file_token de lectura: el
    // backend la copia al almacén gestionado por streaming.
    const cap = await createFileCapabilityAsync({
      filePath: result.path,
      mode: 'read',
      webContentsId: window && window.webContents ? window.webContents.id : null,
      name: path.basename(result.path),
    });
    _recordingTokens.set(sessionId, cap.token);
    return { ...result, file_token: cap.token };
  }
  if (method === 'editor_recording_abort') {
    return manager.abort(sessionId);
  }
  return { handled: false };
}

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
  if (method.startsWith('editor_recording_')) {
    return { handled: true, result: await runEditorRecording(method, params, window) };
  }
  return { handled: true, result: await runEditorImportFiles(params, dialog, window) };
}

module.exports = {
  EDITOR_METHODS,
  MEDIA_FILTERS,
  runEditorImportFiles,
  runEditorRecording,
  handleEditorCall,
};
