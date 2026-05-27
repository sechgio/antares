const BACKEND_METHODS = [
  'version', 'formats', 'plugin_formats',
  'db_records', 'db_import', 'db_export', 'db_clear', 'db_template',
  'db_fields', 'db_fields_update', 'db_fields_reset',
  'db_columns',
  'rename_patterns_get', 'rename_patterns_update', 'rename_patterns_reset',
  'scan_folder',
  'process_start', 'process_status', 'process_cancel',
  'preview', 'preview_image', 'is_video',
  'formatos_list', 'formatos_generate', 'formatos_upload', 'formatos_delete', 'formatos_update_mapping',
  'history_list', 'history_get', 'history_delete', 'history_save',
  'technical_reports_list', 'technical_reports_get', 'technical_reports_create',
  'technical_reports_update', 'technical_reports_delete', 'technical_reports_clear',
  'technical_reports_import_file', 'technical_reports_variables',
  'technical_reports_autocomplete_cs', 'technical_reports_autocomplete_contratista',
  'technical_reports_render_html', 'technical_reports_render_consolidated_html',
  'panel_aviso_corte_parse_excel', 'panel_aviso_corte_compute_match',
  'panel_aviso_corte_render_pdf', 'panel_aviso_corte_template',
  'image_optimizer_zip',
  'jobs_list', 'jobs_get', 'jobs_cancel', 'jobs_cleanup',
  'theme_get', 'theme_save', 'theme_presets', 'theme_preset', 'theme_reset',
  'templates_list', 'template_get',
];

const NATIVE_METHODS = [
  'dialog_files',
  'dialog_folder',
  'dialog_dest',
  'dialog_save',
  'html_to_pdf',
];

// Methods with larger user payloads or slow rendering/import work. Kept next
// to the allowlist so Electron routing metadata changes in one place.
const LONG_RUNNING_METHODS = new Set([
  'process_start',
  'db_import',
  'db_export',
  'db_clear',
  'scan_folder',
  'preview_image',
  'formatos_generate',
  'image_optimizer_zip',
  'technical_reports_import_file',
  'technical_reports_render_consolidated_html',
  'panel_aviso_corte_parse_excel',
  'technical_reports_render_html',
  'panel_aviso_corte_render_pdf',
  'panel_aviso_corte_compute_match',
  'html_to_pdf',
]);

const ALLOWED_RENDERER_METHODS = new Set([...BACKEND_METHODS, ...NATIVE_METHODS]);

module.exports = {
  BACKEND_METHODS,
  NATIVE_METHODS,
  LONG_RUNNING_METHODS,
  ALLOWED_RENDERER_METHODS,
};
