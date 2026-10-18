'use strict';

// Dispatch `native:agent`: los diez métodos públicos agent_* corren sobre el
// runtime durable del proceso principal (electron/agent-runtime.js).

const AGENT_METHODS = new Set([
  'agent_sessions_list',
  'agent_session_create',
  'agent_session_delete',
  'agent_session_rename',
  'agent_messages_list',
  'agent_message_send',
  'agent_tools_list',
  'agent_tools_set',
  'agent_turn_status',
  'agent_turn_cancel',
  'agent_approve',
  'agent_deny',
  'agent_attach',
  'agent_context_remove_file',
  'agent_profiles_list',
  'agent_profile_save',
  'agent_profile_delete',
  'agent_renderer_result',
  'agent_artifact_action',
]);

async function handleAgentCall(method, params) {
  if (method === 'agent_artifact_action') {
    return { handled: true, result: await artifactAction(params || {}) };
  }
  if (method === 'agent_renderer_result') {
    return { handled: true, result: require('./agent-renderer-tools').acceptRendererResult(params || {}) };
  }
  const runtime = require('./agent-runtime');
  await runtime.open();
  const handler = runtime.handlers[method];
  if (!handler) throw new Error(`Método de agente no soportado: ${method}`);
  return { handled: true, result: await handler(params || {}) };
}

async function artifactAction(params) {
  await require('./agent-runtime').open();
  await require('./agent-shared').requireSession(String(params.session_id || ''));
  const { _callBackend } = require('./ipc-router');
  if (['preview', 'review'].includes(params.action)) return _callBackend('agent_internal_artifact_action', params);
  const file = await _callBackend('agent_internal_artifact_action', { ...params, action: 'file' });
  if (params.action === 'open') {
    const error = await require('electron').shell.openPath(file.path);
    if (error) throw new Error(error);
    return { opened: true };
  }
  let method;
  let args;
  if (params.action === 'save') {
    const { dialog } = require('electron');
    const win = require('./window-manager').getMainWindow();
    const choice = await dialog.showSaveDialog(win, { title: 'Guardar PDF revisado', defaultPath: file.name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    const path = require('node:path');
    method = 'drafts_save';
    args = { name: path.basename(file.path), destination_folder: path.dirname(choice.filePath),
      filename: path.basename(choice.filePath), overwrite: require('node:fs').existsSync(choice.filePath) };
  } else if (params.action === 'print') {
    method = 'artifact_print';
    args = { artifact_id: params.artifact_id, file_index: params.file_index || 0, sha256: file.sha256,
      printer_name: params.printer_name, copies: params.copies ?? 1, pages: params.pages || '',
      duplex: params.duplex || 'none', quality: params.quality || 'normal' };
  } else throw new Error('Acción de artefacto no disponible');
  return _callBackend('agent_internal_artifact_effect', { session_id: params.session_id,
    call_id: `artifact-${String(params.request_id || require('node:crypto').randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)}`, method, params: args });
}

module.exports = { AGENT_METHODS, handleAgentCall };
