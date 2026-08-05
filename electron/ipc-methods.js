const BACKEND_METHODS = [
  'version', 'formats',
  'db_records', 'db_import', 'db_export', 'db_clear', 'db_template',
  'db_parse_mapping', 'db_validate_mapping',
  'db_fields', 'db_fields_update', 'db_fields_reset',
  'db_columns',
  'rename_patterns_get', 'rename_patterns_update', 'rename_patterns_reset',
  'process_start', 'process_status', 'process_cancel',
  'preview', 'is_video',
  'db_detect_key_column',
  'formatos_list', 'formatos_generate', 'formatos_upload', 'formatos_delete', 'formatos_get_template', 'formatos_render_template_page', 'formatos_update_mapping',
  'history_list', 'history_get', 'history_delete', 'history_delete_many', 'history_save',
  'history_export',
  'technical_reports_list', 'technical_reports_get', 'technical_reports_create',
  'technical_reports_update', 'technical_reports_delete', 'technical_reports_clear',
  'technical_reports_import_file',
  'technical_reports_autocomplete_cs', 'technical_reports_autocomplete_contratista',
  'technical_reports_render_html', 'technical_reports_render_consolidated_html',
  'informes_v2_list', 'informes_v2_get', 'informes_v2_create',
  'informes_v2_update', 'informes_v2_delete', 'informes_v2_clear',
  'informes_v2_import_file', 'informes_v2_download_template',
  'informes_v2_render_html', 'informes_v2_render_consolidated_html',
  'fichas_tecnicas_list', 'fichas_tecnicas_get', 'fichas_tecnicas_create',
  'fichas_tecnicas_update', 'fichas_tecnicas_delete', 'fichas_tecnicas_clear',
  'fichas_tecnicas_import_file', 'fichas_tecnicas_render_html',
  'fichas_tecnicas_render_consolidated_html',
  'panel_aviso_corte_parse_excel', 'panel_aviso_corte_compute_match',
  'panel_aviso_corte_render_pdf', 'panel_aviso_corte_template',
  'image_optimizer_zip',
  'image_optimizer_save_files',
  'sellador_apply', 'sellador_inspect_pdf', 'sellador_render_page',
  'theme_get', 'theme_save', 'theme_presets', 'theme_preset', 'theme_reset',
  'templates_list', 'template_get',
  'canvas_list', 'canvas_get', 'canvas_save', 'canvas_create', 'canvas_delete', 'canvas_duplicate', 'canvas_export_cmyk_pdf', 'canvas_get_history', 'canvas_save_history',
  'generar_ubicaciones',
  'preview_ubicacion',
  'evidencia_volanteo_render',
];

const NATIVE_METHODS = [
  'dialog_files',
  'dialog_dest',
  'dialog_save',
  'dialog_folder',
  'html_to_pdf',
  'local_thumbnail',
  'local_image_data_url',
  'register_local_path',
];

const { AUTOIMG_METHODS } = require('./autoimg-ipc-methods');
const { UBICACIONES_METHODS } = require('./ubicaciones-ipc-methods');

// Methods with larger user payloads or slow rendering/import work. The list
// lives in shared/long-running-methods.json so the Electron main process and
// the renderer (frontend/src/api.ts) share one source of truth and cannot
// drift on which methods get the extended timeout.
const LONG_RUNNING_METHODS = new Set(require('../shared/long-running-methods.json'));

const ALLOWED_RENDERER_METHODS = new Set([...BACKEND_METHODS, ...NATIVE_METHODS, ...AUTOIMG_METHODS, ...UBICACIONES_METHODS]);

module.exports = {
  BACKEND_METHODS,
  NATIVE_METHODS,
  LONG_RUNNING_METHODS,
  ALLOWED_RENDERER_METHODS,
};
