'use strict';

const path = require('node:path');
const os = require('node:os');
const { assert, finish, stubModule } = require('./helpers/harness');
const { stubIpcDependencies } = require('./helpers/ipc-router');

async function main() {
  let mime;
  let choice = { canceled: true };
  let options;
  const calls = [];
  stubIpcDependencies({ electron: { dialog: { showSaveDialog: async (_win, value) => { options = value; return choice; } } } });
  stubModule('electron/agent-runtime', { open: async () => {} });
  stubModule('electron/agent-shared', { requireSession: async (id) => { if (id !== 's1') throw new Error('Conversación desconocida'); } });
  stubModule('electron/ipc-router', { _callBackend: async (method, params) => {
    calls.push({ method, params });
    return params.action === 'file'
      ? { path: path.join(os.tmpdir(), 'draft-image.png'), name: 'grafico.png', sha256: 'hash', mime }
      : { png_base64: 'png', sha256: 'hash' };
  } });
  const { handleAgentCall } = require('../electron/agent-handlers');
  const params = { session_id: 's1', artifact_id: 'a1', file_index: 2, sha256: 'hash' };
  await handleAgentCall('agent_artifact_action', { ...params, action: 'preview', full_size: true });
  assert(calls.length === 2 && calls[0].params.action === 'file' && calls[1].method === 'agent_internal_artifact_action'
    && calls[1].params.full_size === true && calls[1].params.file_index === 2,
  'la ampliación conserva sesión, índice y hash en el lector privado');
  for (const [type, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], [undefined, 'pdf']]) {
    mime = type;
    const result = await handleAgentCall('agent_artifact_action', { ...params, action: 'save' });
    assert(result.result.cancelled && options.filters[0].extensions[0] === extension
      && options.title === (type ? 'Guardar imagen' : 'Guardar PDF revisado'),
    `guardar usa el formato ${extension} y conserva el guardado PDF existente`);
  }
  mime = 'image/png';
  choice = { canceled: false, filePath: path.join(os.tmpdir(), 'agent-image-download-test.png') };
  await handleAgentCall('agent_artifact_action', { ...params, action: 'save', request_id: 'stable-request' });
  const effect = calls.at(-1);
  assert(effect.method === 'agent_internal_artifact_effect' && effect.params.method === 'drafts_save'
    && effect.params.session_id === 's1' && effect.params.call_id === 'artifact-stable-request',
  'descargar reutiliza drafts_save y su identidad de aprobación');
  const before = calls.length;
  let rejected = false;
  try { await handleAgentCall('agent_artifact_action', { ...params, session_id: 'other', action: 'preview' }); }
  catch { rejected = true; }
  assert(rejected && calls.length === before, 'una sesión desconocida se rechaza antes de leer imágenes');
  finish();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
