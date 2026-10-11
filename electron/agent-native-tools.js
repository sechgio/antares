'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Herramientas del agente que se ejecutan en el proceso principal (métodos
// native:* del catálogo). Python sigue siendo dueño de la reserva, la
// aprobación y el comprobante de cada operación; aquí solo se declara qué
// métodos nativos ve el modelo, con qué esquema y si son lectura o efecto.
// Configuración de cuentas, credenciales, OAuth y reglas permanentes (como el
// auto-sync) quedan fuera: son acciones de la interfaz humana.

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

// Exportación a PDF de los informes que el backend renderiza en HTML: el
// HTML no pasa por el modelo; se imprime con el mismo motor que la pantalla
// (html_to_pdf) y el PDF queda en los borradores de la conversación.
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
];

function nativeToolSpecs() {
  return SPECS.map((s) => ({ ...s }));
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
  const target = path.join(dir, filename);
  await fs.promises.copyFile(out.saved_path, target);
  await fs.promises.rm(out.saved_path, { force: true });
  return { saved_path: target, filename, ...(rendered.count !== undefined ? { count: rendered.count } : {}) };
}

async function runNativeTool(name, params, { sessionId } = {}) {
  if (!SPECS.some((s) => s.name === name)) throw new Error(`Herramienta nativa no disponible: ${name}`);
  if (REPORT_EXPORTS[name]) return exportReportPdf(REPORT_EXPORTS[name], params || {}, sessionId);
  const { handleAutoimgCall } = require('./autoimg-handlers');
  const out = await handleAutoimgCall(name, params || {});
  if (!out || !out.handled) throw new Error(`Herramienta nativa no disponible: ${name}`);
  return out.result;
}

module.exports = { nativeToolSpecs, runNativeTool, draftName, AUTOIMG_READS, AUTOIMG_EFFECTS, REPORT_EXPORTS };
