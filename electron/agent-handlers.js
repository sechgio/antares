'use strict';

const { nativeMethods } = require('../shared/ipc-method-catalog');
const { FORBIDDEN_FALLBACK_EXTENSIONS } = require('./ipc-file-policy');

const AGENT_METHODS = nativeMethods('agent');
const AGENT_PRIVILEGE_CONFIRM_MIN_INTERVAL_MS = 5000;
const PERMISSION_RANK = { ask: 0, auto: 1, full: 2 };
const PERMISSION_LABELS = { ask: 'Solicitar aprobación', auto: 'Aprobar por mí', full: 'Acceso completo' };
let _lastAgentPrivilegeConfirmAt = 0;

function _ruleElevationSummary(params) {
  const lines = [];
  const rules = params && typeof params.rules === 'object' && params.rules ? params.rules : {};
  for (const [channel, decision] of Object.entries(rules)) {
    if (decision === 'allow') lines.push(`canal ${channel}: permitir automáticamente`);
  }
  const scoped = Array.isArray(params && params.scoped_rules) ? params.scoped_rules : [];
  for (const rule of scoped) {
    if (rule && rule.decision === 'allow') {
      lines.push(`${rule.scope || 'alcance'} «${String(rule.value || '').slice(0, 120)}»: permitir automáticamente`);
    }
  }
  return lines.slice(0, 8);
}

async function _confirmAgentPrivilegeEscalation(method, params, runtime) {
  let title = '';
  let message = '';
  let lines = [];
  if (method === 'agent_session_permissions_set') {
    const target = params.permission_mode;
    if (!['auto', 'full'].includes(target)) return;
    const sessions = await runtime.handlers.agent_sessions_list({});
    const current = (sessions.sessions || []).find((session) => session.id === params.id);
    const currentMode = current && current.permission_mode ? current.permission_mode : 'ask';
    if ((PERMISSION_RANK[target] || 0) <= (PERMISSION_RANK[currentMode] || 0)) return;
    title = 'Elevar permisos del agente';
    message = `¿Activar «${PERMISSION_LABELS[target]}» en esta conversación?`;
    lines = [
      target === 'full'
        ? 'El agente podrá ejecutar acciones permitidas sin pedir confirmación en cada paso.'
        : 'El agente podrá realizar acciones de bajo riesgo sin pedir confirmación en cada paso.',
      '',
      `Modo actual: ${PERMISSION_LABELS[currentMode] || currentMode}.`,
    ];
  } else if (method === 'agent_session_rules_set' || method === 'agent_policy_rules_set') {
    lines = _ruleElevationSummary(params);
    if (!lines.length) return;
    title = method === 'agent_policy_rules_set' ? 'Permitir acciones automáticamente en todas las conversaciones' : 'Permitir acciones automáticamente en esta conversación';
    message = '¿Guardar reglas que permiten acciones del agente sin confirmación paso a paso?';
  } else {
    return;
  }

  const now = Date.now();
  if (now - _lastAgentPrivilegeConfirmAt < AGENT_PRIVILEGE_CONFIRM_MIN_INTERVAL_MS) {
    throw new Error('Los permisos del agente no pueden elevarse con tanta rapidez; espera unos segundos');
  }
  _lastAgentPrivilegeConfirmAt = now;
  const { dialog } = require('electron');
  if (!dialog || typeof dialog.showMessageBox !== 'function') {
    throw new Error('No se puede elevar permisos del agente sin confirmación nativa');
  }
  const win = require('./window-manager').getMainWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Permitir elevación', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title,
    message,
    detail: lines.join('\n').slice(0, 900),
  });
  if (response !== 0) throw new Error('Elevación de permisos del agente cancelada');
}

async function handleAgentCall(method, params) {
  if (method === 'agent_artifact_action') {
    return { handled: true, result: await artifactAction(params || {}) };
  }
  if (method === 'agent_renderer_result') {
    return { handled: true, result: require('./agent-renderer-tools').acceptRendererResult(params || {}) };
  }
  const runtime = require('./agent-runtime');
  if (method !== 'agent_browser') await runtime.open();
  await _confirmAgentPrivilegeEscalation(method, params || {}, runtime);
  const handler = runtime.handlers[method];
  if (!handler) throw new Error(`Método de agente no soportado: ${method}`);
  return { handled: true, result: await handler(params || {}) };
}

async function artifactAction(params) {
  await require('./agent-runtime').open();
  await require('./agent-shared').requireSession(String(params.session_id || ''));
  const { _callBackend } = require('./ipc-router');
  if (params.action === 'review' || params.action === 'versions' || params.action === 'restore')
    return _callBackend('agent_internal_artifact_action', params);
  const file = await _callBackend('agent_internal_artifact_action', { ...params, action: 'file' });
  if (file.page) {
    if (params.action === 'preview') return { html: require('./agent-pages').preview(file.page, params.color_scheme), sha256: file.sha256 };
    if (params.action === 'embed') return { url: await require('./agent-preview').embedPage(file.page, params.color_scheme), sha256: file.sha256 };
    if (params.action !== 'open') throw new Error('Las páginas interactivas se abren dentro de Agent');
    await require('./agent-browser').openPage(file.page, params.color_scheme);
    return { opened: true };
  }
  if (params.action === 'preview') return _callBackend('agent_internal_artifact_action', params);
  if (params.action === 'open') {
    const extension = require('node:path').extname(file.path).toLowerCase();
    if (FORBIDDEN_FALLBACK_EXTENSIONS.has(extension)) {
      throw new Error(`Antares no abre artefactos ejecutables (${extension}); ábrelo tú desde el Explorador`);
    }
    const error = await require('electron').shell.openPath(file.path);
    if (error) throw new Error(error);
    return { opened: true };
  }
  let method;
  let args;
  if (params.action === 'save') {
    const { dialog } = require('electron');
    const win = require('./window-manager').getMainWindow();
    const imageExtension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.mime];
    const choice = await dialog.showSaveDialog(win, { title: imageExtension ? 'Guardar imagen' : 'Guardar PDF revisado', defaultPath: file.name,
      filters: [{ name: imageExtension ? 'Imagen' : 'PDF', extensions: [imageExtension || 'pdf'] }] });
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
