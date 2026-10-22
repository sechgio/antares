'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OBJECT = { type: 'object', properties: {} };
const FOLDER = {
  type: 'object',
  properties: { folder_id: { type: 'string', description: 'ID o URL de la carpeta de Drive' } },
  required: ['folder_id'],
};
const RANGE = {
  type: 'object',
  properties: { range: { type: 'string', description: 'Rango A1 permitido de la hoja de AutoIMG' } },
  required: ['range'],
};
const RANGE_VALUES = {
  type: 'object',
  properties: {
    range: { type: 'string', description: 'Rango A1 permitido de la hoja de AutoIMG' },
    values: { type: 'array', items: { type: 'array', items: {} }, description: 'Filas de valores' },
  },
  required: ['range', 'values'],
};
const FORCE = { type: 'object', properties: { force: { type: 'boolean' } } };

const AUTOIMG_READS = {
  autoimg_status: ['Consultar el estado de AutoIMG', OBJECT],
  autoimg_operation_status: ['Consultar la operación en curso de AutoIMG', OBJECT],
  autoimg_drive_status: ['Consultar la conexión de AutoIMG con Drive', OBJECT],
  autoimg_sheets_auth_status: ['Consultar la cuenta de Google de AutoIMG', OBJECT],
  autoimg_sheets_get_config: ['Consultar la hoja configurada en AutoIMG', OBJECT],
  autoimg_sheets_read_range: ['Leer un rango de la hoja de AutoIMG', RANGE],
  autoimg_folders_list: ['Listar las carpetas vigiladas por AutoIMG', FORCE],
  autoimg_drive_list_folder: ['Listar los archivos de una carpeta de Drive', FOLDER],
  autoimg_drive_verify_folder: ['Verificar una carpeta de Drive', FOLDER],
  autoimg_drive_folder_preview: ['Previsualizar una carpeta de Drive', FOLDER],
  autoimg_drive_scan_nis: ['Buscar NIS en una carpeta de Drive', {
    type: 'object',
    properties: { folder_id: { type: 'string' }, folder_name: { type: 'string' } },
    required: ['folder_id'],
  }],
  autoimg_arrastre_list: ['Listar el arrastre de AutoIMG', FORCE],
  autoimg_logs_list: ['Listar el registro de AutoIMG', FORCE],
  autoimg_rename_dest_config: ['Consultar el destino de renombrado de AutoIMG', OBJECT],
};

const AUTOIMG_EFFECTS = {
  autoimg_sheets_write_range: ['Escribir un rango de la hoja de AutoIMG', RANGE_VALUES],
  autoimg_sheets_append_row: ['Añadir filas a la hoja de AutoIMG', RANGE_VALUES],
  autoimg_scan_all: ['Escanear todas las carpetas de AutoIMG', OBJECT],
  autoimg_scan_and_sync: ['Escanear y sincronizar AutoIMG con la hoja', OBJECT],
  autoimg_sync_to_sheet: ['Sincronizar AutoIMG hacia la hoja', OBJECT],
  autoimg_sync_from_sheet: ['Sincronizar AutoIMG desde la hoja', OBJECT],
  autoimg_rename_export: ['Renombrar y exportar imágenes a una carpeta de Drive', {
    type: 'object',
    properties: { dest_folder_id: { type: 'string' }, only_completos: { type: 'boolean' } },
    required: ['dest_folder_id'],
  }],
  autoimg_folders_add: ['Añadir una carpeta vigilada a AutoIMG', {
    type: 'object',
    properties: { folder_id: { type: 'string' }, name: { type: 'string' } },
    required: ['folder_id'],
  }],
  autoimg_folders_remove: ['Quitar una carpeta vigilada de AutoIMG', FOLDER],
  autoimg_folders_toggle: ['Activar o pausar una carpeta de AutoIMG', {
    type: 'object',
    properties: { folder_id: { type: 'string' }, enabled: { type: 'boolean' } },
    required: ['folder_id', 'enabled'],
  }],
  autoimg_cancel_operation: ['Cancelar la operación en curso de AutoIMG', OBJECT],
};

const REPORT_EXPORTS = {
  technical_reports_export_pdf: {
    module: 'technicalReports', label: 'Informes técnicos', single: 'technical_reports_render_html',
    consolidated: 'technical_reports_render_consolidated_html', idsKey: 'report_ids',
  },
  informes_v2_export_pdf: {
    module: 'informesV2', label: 'Informes v2', single: 'informes_v2_render_html',
    consolidated: 'informes_v2_render_consolidated_html', idsKey: 'report_ids',
  },
  fichas_tecnicas_export_pdf: {
    module: 'fichasTecnicas', label: 'Fichas Técnicas', single: 'fichas_tecnicas_render_html',
    consolidated: 'fichas_tecnicas_render_consolidated_html', idsKey: 'ficha_ids',
  },
};
const EXPORT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Registro a exportar en un PDF individual' },
    ids: { type: 'array', items: { type: 'string' }, description: 'Registros del consolidado; vacío = todos' },
    filename: { type: 'string', description: 'Nombre del PDF en los borradores' },
  },
  required: ['filename'],
};

const ID_SCHEMA = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
const RENDERER_TOOLS = {
  padron_describe: ['padron', 'Consultar campos y formatos de Padrones', OBJECT, false],
  padron_export_pdf: ['padron', 'Generar un PDF de Padrones con sus posiciones y folios', {
    type: 'object', properties: { filename: { type: 'string' }, header: { type: 'object' },
      rows: { type: 'array', maxItems: 10000, items: { type: 'object' } },
      format: { type: 'string', enum: ['service-interruption', 'volante-lurigancho', 'volanteo-lurigancho-v2', 'water-cut-notice'] },
      orientation: { type: 'string', enum: ['landscape', 'portrait'] }, folio_start: { type: 'integer', minimum: 1 } },
    required: ['filename', 'header', 'rows'],
  }, false],
  volantes_describe: ['volantes', 'Consultar campos y formatos de Volantes', OBJECT, false],
  volantes_export_pdf: ['volantes', 'Generar un PDF de Volantes con su motor actual', {
    type: 'object', properties: { filename: { type: 'string' }, rows: { type: 'array', maxItems: 200, items: { type: 'object' } },
      layout: { type: 'string', enum: ['2-up', '3-up'] } }, required: ['filename', 'rows'],
  }, false],
  document_generate: ['documents', 'Generar un PDF con la plantilla y su motor RGB o CMYK', null, false],
  canvas_fill_fields: ['canvas', 'Completar campos de Canvas comprobando el editor y la revisión', null, true],
  espacios_list: ['espacios', 'Listar Espacios accesibles en la sesión actual', OBJECT, false],
  espacios_projects: ['espacios', 'Listar proyectos de un Espacio', ID_SCHEMA, false],
  espacios_tasks: ['espacios', 'Listar tareas de un proyecto', ID_SCHEMA, false],
  espacios_task_get: ['espacios', 'Consultar una tarea', ID_SCHEMA, false],
  espacios_task_comments: ['espacios', 'Consultar comentarios de una tarea', ID_SCHEMA, false],
  espacios_task_activity: ['espacios', 'Consultar actividad de una tarea', ID_SCHEMA, false],
  espacios_members: ['espacios', 'Consultar miembros del equipo', OBJECT, false],
  espacios_columns: ['espacios', 'Consultar columnas de un proyecto e inicializarlas si faltan', ID_SCHEMA, true],
  espacios_my_tasks: ['espacios', 'Consultar mis tareas', OBJECT, false],
  espacios_my_task_origins: ['espacios', 'Consultar los proyectos de mis tareas', OBJECT, false],
};
const SPACE_INPUTS = {
  espacio: { name: { type: 'string' }, color: { type: ['string', 'null'] } },
  proyecto: { name: { type: 'string' }, color: { type: ['string', 'null'] }, is_favorite: { type: 'boolean' } },
  column: { name: { type: 'string' }, color: { type: 'string' }, sort_order: { type: 'number' }, is_done: { type: 'boolean' } },
  tarea: { title: { type: 'string' }, description: { type: ['string', 'null'] }, status: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assignee_id: { type: ['string', 'null'] },
    start_date: { type: ['string', 'null'] }, due_date: { type: ['string', 'null'] }, sort_order: { type: 'number' } },
};
for (const [kind, properties] of Object.entries(SPACE_INPUTS)) {
  for (const action of ['create', 'update', 'delete']) {
    RENDERER_TOOLS[`espacios_${kind}_${action}`] = ['espacios', `${action === 'create' ? 'Crear' : action === 'update' ? 'Actualizar' : 'Eliminar'} ${kind}`, {
      type: 'object', properties: { id: { type: 'string' }, expected_updated_at: { type: 'string' },
        input: { type: 'object', properties, additionalProperties: false, required: action === 'create' ? [kind === 'tarea' ? 'title' : 'name'] : [] } },
      required: action === 'delete' ? ['id'] : action === 'create' && kind === 'espacio' ? ['input'] : ['id', 'input'],
    }, true];
  }
}
const taskUpdateSchema = RENDERER_TOOLS.espacios_tarea_update[2];
taskUpdateSchema.required.push('expected_updated_at');
taskUpdateSchema.properties.expected_updated_at = {
  type: 'string', minLength: 1,
  description: 'Revisión updated_at devuelta por espacios_task_get; consulta la tarea antes de actualizarla',
};
RENDERER_TOOLS.espacios_comment_create = ['espacios', 'Añadir un comentario a una tarea', {
  type: 'object', properties: { id: { type: 'string' }, body: { type: 'string' } }, required: ['id', 'body'],
}, true];

const CLOUD = {};
for (const service of [require('./google-workspace-service'), require('./microsoft-files-service')]) {
  for (const name of Object.keys(service.TOOLS)) CLOUD[name] = service;
}

const WEB = require('./agent-browser').TOOLS;

function spec(name, [label, schema], gated) {
  return {
    name,
    description: `AutoIMG · ${name} (${gated ? 'efecto: requiere aprobación del usuario' : 'solo lectura'}): ${label}`,
    gated,
    kind: 'native',
    module: 'autoimg',
    label,
    inputSchema: schema,
  };
}

const SPECS = [
  ...Object.entries(AUTOIMG_READS).map(([name, def]) => spec(name, def, false)),
  ...Object.entries(AUTOIMG_EFFECTS).map(([name, def]) => spec(name, def, true)),
  ...Object.entries(REPORT_EXPORTS).map(([name, def]) => ({
    name,
    description: `${def.label} · ${name} (borrador sin aprobación): genera el PDF con el mismo motor de la pantalla`,
    gated: false,
    kind: 'native',
    module: def.module,
    label: `Generar el PDF de ${def.label}`,
    inputSchema: EXPORT_SCHEMA,
  })),
  ...Object.entries(RENDERER_TOOLS).map(([name, [module, label, schema, gated]]) => ({
    name, module, label, gated, kind: 'native', description: `${label} (${gated ? 'requiere aprobación' : 'lectura o borrador interno'})`,
    inputSchema: schema || OBJECT, inheritSchema: !schema,
  })),
  ...Object.entries(WEB).map(([name, [label, schema, gated]]) => ({
    name, module: 'computer', label, gated, kind: 'native', inputSchema: schema,
    description: `Navegador · ${name} (${gated ? 'efecto: requiere aprobación del usuario' : 'solo lectura en el navegador aislado del agente'}): ${label}`,
  })),
  ...Object.entries(CLOUD).map(([name, service]) => {
    const [label, schema, gated] = service.TOOLS[name];
    return { name, module: 'connections', label, gated, kind: 'native', inputSchema: schema,
      description: `Conexiones · ${label} (${gated ? 'efecto: requiere aprobación del usuario' : 'lectura o borrador interno'})` };
  }),
];

function nativeToolSpecs() {
  return SPECS.map((s) => ({ ...s }));
}

async function nativeToolContext(name) {
  const selected = SPECS.find((item) => item.name === name);
  if (!selected) throw new Error(`Herramienta nativa no disponible: ${name}`);
  const { createHash } = require('node:crypto');
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const context = { tool_version: hash({ policy: 1, spec: selected }) };
  if (WEB[name] && selected.gated) return Object.assign(context, await require('./agent-browser').approvalContext());
  if (CLOUD[name]) return Object.assign(context, await CLOUD[name].context(name));
  if (selected.module === 'espacios') {
    Object.assign(context, await require('./agent-renderer-tools').runRendererTool('espacios_context'));
    return context;
  }
  if (selected.module !== 'autoimg' || !selected.gated) return context;
  const auth = require('./google-session');
  const scope = require('./autoimg-user-scope');
  const store = require('./autoimg-user-store');
  const session = auth.captureAuthSession();
  context.account = scope.getActiveEmail() || 'Sin cuenta conectada';
  context.account_id = session.userKey;
  if (name === 'autoimg_cancel_operation') return context;
  const tokens = await auth.getValidTokens(session);
  auth.assertAuthSessionCurrent(session);
  if (!tokens || !session.userKey) throw new Error('Conecta tu cuenta de Google antes de pedir esta acción');
  const scopes = [...new Set(String(tokens.scope || '').split(/\s+/).filter(Boolean))].sort();
  const prefix = 'https://www.googleapis.com/auth/';
  if (!scopes.includes(`${prefix}spreadsheets`)) {
    throw new Error('No hay permiso verificado para modificar la hoja; vuelve a conectar Google en AutoIMG');
  }
  if (['autoimg_scan_all', 'autoimg_scan_and_sync', 'autoimg_rename_export'].includes(name)
    && !scopes.includes(`${prefix}drive`)) {
    throw new Error('No hay permiso verificado para esta operación de Drive; vuelve a conectar Google en AutoIMG');
  }
  const sheets = require('./google-sheets-service');
  context.sheet_id = sheets.getSheetId() || store.loadSheetConfig().sheet_id;
  context.scopes = scopes;
  context.auth_identity = hash({ refresh: tokens.refresh_token, client: auth.getOAuthConfig().clientId });
  return context;
}

function draftsDir(sessionId) {
  const safe = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!safe) throw new Error('Los borradores requieren una conversación');
  const { antaresUserData } = require('./canvas-assets');
  return antaresUserData('ai-agent', 'drafts', safe);
}

function draftName(value) {
  const name = String(value || '').trim();
  if (!name || name !== path.basename(name) || /[<>:"/\\|?*\x00]/.test(name) || name === '.' || name === '..') {
    throw new Error(`Nombre de archivo no válido: ${value}`);
  }
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

async function exportReportPdf(def, params, sessionId) {
  const { _callBackend } = require('./ipc-router');
  const ids = Array.isArray(params.ids) ? params.ids.map(String) : [];
  const rendered = params.id
    ? await _callBackend(def.single, { id: String(params.id) })
    : await _callBackend(def.consolidated, ids.length ? { [def.idsKey]: ids } : {});
  const { BrowserWindow, session } = require('electron');
  const { renderHtmlToPdf } = require('./pdf-render');
  const filename = draftName(params.filename);
  const out = await renderHtmlToPdf({ html: rendered.html, filename }, { BrowserWindow, session }, null);
  const dir = draftsDir(sessionId);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${require('node:crypto').randomUUID().slice(0, 8)}-${filename}`);
  await fs.promises.copyFile(out.saved_path, target, fs.constants.COPYFILE_EXCL);
  await fs.promises.rm(out.saved_path, { force: true });
  return { saved_path: target, filename, artifact_metadata: { family: 'html', template_id: def.single,
    template_revision: require('node:crypto').createHash('sha256').update(rendered.html).digest('hex'),
    module: def.module, sources: [{ kind: 'records', ids: params.id ? [String(params.id)] : ids }],
  }, ...(rendered.count !== undefined ? { count: rendered.count } : {}) };
}

async function saveNativePdf(params, sessionId, data) {
  const filename = draftName(params.filename);
  const dir = draftsDir(sessionId);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${require('node:crypto').randomUUID().slice(0, 8)}-${filename}`);
  await fs.promises.writeFile(target, Buffer.from(data.pdf_base64, 'base64'), { flag: 'wx' });
  return { saved_path: target, filename, count: data.count, artifact_metadata: { family: 'html',
    template_id: params.format || params.layout || 'default', module: data.module,
    sources: [{ kind: 'rows', count: params.rows.length }], template_revision: data.template_revision } };
}

async function generateDocument(params, sessionId) {
  const { _callBackend } = require('./ipc-router');
  const plan = await _callBackend('agent_internal_document_plan', { session_id: sessionId, params });
  if (plan.complete) return plan.result;
  const { runRendererTool } = require('./agent-renderer-tools');
  const { BrowserWindow, session } = require('electron');
  const saved = [];
  for (const item of plan.items) {
    const { html } = await runRendererTool('document_render', item);
    const out = await require('./pdf-render').renderHtmlToPdf({ html, filename: item.filename }, { BrowserWindow, session }, null);
    const dir = draftsDir(sessionId);
    await fs.promises.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${require('node:crypto').randomUUID().slice(0, 8)}-${draftName(item.filename)}`);
    await fs.promises.copyFile(out.saved_path, target, fs.constants.COPYFILE_EXCL);
    await fs.promises.rm(out.saved_path, { force: true });
    saved.push(target);
  }
  return { generated: true, saved_paths: saved, artifact_metadata: plan.metadata };
}

async function runNativeTool(name, params, { sessionId, approvedContext } = {}) {
  if (!SPECS.some((s) => s.name === name)) throw new Error(`Herramienta nativa no disponible: ${name}`);
  if (REPORT_EXPORTS[name]) return exportReportPdf(REPORT_EXPORTS[name], params || {}, sessionId);
  if (SPECS.find((s) => s.name === name).gated) {
    const current = await nativeToolContext(name);
    if (!approvedContext || JSON.stringify(current) !== JSON.stringify(approvedContext)) {
      if (WEB[name]) throw new Error('La página cambió después de aprobar; vuelve a leerla con web_read y solicita una nueva aprobación');
      throw new Error('La cuenta, los permisos o la hoja cambiaron después de aprobar; solicita una nueva aprobación');
    }
  }
  if (CLOUD[name]) return CLOUD[name].run(name, params || {}, { dir: draftsDir(sessionId) });
  if (WEB[name]) return require('./agent-browser').run(name, params || {}, { dir: `${draftsDir(sessionId)}.screens`, approvedContext });
  if (name === 'document_generate') return generateDocument(params, sessionId);
  if (RENDERER_TOOLS[name]) {
    const result = await require('./agent-renderer-tools').runRendererTool(name,
      { ...params, ...(approvedContext?.account_id ? { _expected_account_id: approvedContext.account_id } : {}) },
      { gated: !!RENDERER_TOOLS[name][3] });
    return name === 'padron_export_pdf' || name === 'volantes_export_pdf' ? saveNativePdf(params, sessionId, result) : result;
  }
  const { handleAutoimgCall } = require('./autoimg-handlers');
  const out = await handleAutoimgCall(name, params || {});
  if (!out || !out.handled) throw new Error(`Herramienta nativa no disponible: ${name}`);
  require('./autoimg-security').assertNoSecretInObject(out.result);
  return out.result;
}

module.exports = { nativeToolSpecs, nativeToolContext, runNativeTool, draftName };
