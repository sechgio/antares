/**
 * API bridge: habla con el backend Python via Electron IPC (JSON-RPC)
 * en vez de HTTP fetch como en la arquitectura antigua (FastAPI+PyQt5).
 */

import type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision } from './types';

export type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision };

// ─── Electron IPC bridge ───────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      backendStatus: () => Promise<{ state: string; ready: boolean; lastError: { kind: string; message: string; stderrTail: string } | null; stderrTail: string }>;
      backendRestart: () => Promise<{ success: boolean; state: string }>;
      onNotify: (callback: (method: string, params: unknown) => void) => () => void;
      minimizeWindow: () => Promise<unknown>;
      maximizeWindow: () => Promise<unknown>;
      closeWindow: () => Promise<unknown>;
      showAppMenu: (menuIndex: number, position: { x: number; y: number }) => Promise<unknown>;
      autoUpdateCheck: () => Promise<{ success: boolean; reason?: string }>;
      autoUpdateInstall: () => Promise<{ success: boolean; reason?: string }>;
      onAutoUpdateStatus: (callback: (data: { status: string; version: string | null; progress: number; message?: string }) => void) => () => void;
    };
  }
}

const IPC_TIMEOUT = 30_000;           // default timeout — most ops finish in <5s
const IPC_LONG_TIMEOUT = 900_000;     // 15 min for large PDF/ZIP/image batches
const IPC_MAX_RETRIES = 2;
const IPC_RETRY_DELAY = 500;          // fast retry — backend is usually ready by the time we retry

const LONG_RUNNING_METHODS = new Set([
  'process_start',
  'db_import',
  'db_export',
  'db_clear',
  'scan_folder',
  'preview_image',
  'formatos_generate',
  'sellador_apply',
  'sellador_render_page',
  'image_optimizer_zip',
  'technical_reports_import_file',
  'technical_reports_render_consolidated_html',
  'panel_aviso_corte_parse_excel',
  'technical_reports_render_html',
  'panel_aviso_corte_render_pdf',
  'panel_aviso_corte_compute_match',
  'html_to_pdf',
]);

const _delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const _sanitizeHtmlForPdf = (html: string): string => {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/url\(\s*(['"]?)(.+?)\1\s*\)/gi, (match, _quote, urlValue: string) => {
      return urlValue.trim().toLowerCase().startsWith('data:') ? match : "url('')";
    });
  const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: file:; font-src data:;">';
  const injectedHtml = stripped.replace(/<head([^>]*)>/i, `<head$1>${cspMeta}`);
  return /<head/i.test(injectedHtml) ? injectedHtml : cspMeta + injectedHtml;
};

const _isRetryable = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('backend no disponible') ||
    msg.includes('todavía se está iniciando') ||
    msg.includes('backend process exited') ||
    msg.includes('backend process not available') ||
    msg.includes('stdin write failed') ||
    msg.includes('se cerró') ||
    msg.includes('backend_starting') ||
    msg.includes('backend_exited') ||
    msg.includes('cerró inesperadamente') ||
    msg.includes('backend fatal') ||
    msg.includes('restarting')
  );
};

const _invoke = async <T>(method: string, params?: Record<string, unknown> | object): Promise<T> => {
  if (!window.electronAPI) {
    throw new Error('Electron IPC no disponible');
  }

  const timeoutMs = LONG_RUNNING_METHODS.has(method) ? IPC_LONG_TIMEOUT : IPC_TIMEOUT;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= IPC_MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        window.electronAPI.invoke(method, params as Record<string, unknown>),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`IPC timeout: ${method}`)), timeoutMs)
        ),
      ]);
      return result as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (_isRetryable(err) && attempt < IPC_MAX_RETRIES) {
        console.warn(`[api] Retry ${attempt + 1}/${IPC_MAX_RETRIES} for "${method}": ${lastError.message}`);
        await _delay(IPC_RETRY_DELAY * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error('IPC call failed');
};

export function onNotify(callback: (method: string, params: unknown) => void) {
  if (!window.electronAPI) return () => {};
  return window.electronAPI.onNotify(callback);
}

export interface BackendStatus {
  state: string;
  ready: boolean;
  lastError: { kind: string; message: string; stderrTail: string } | null;
  stderrTail: string;
}

export async function getBackendStatus(): Promise<BackendStatus> {
  if (!window.electronAPI) {
    return { state: 'unavailable', ready: false, lastError: null, stderrTail: '' };
  }
  return window.electronAPI.backendStatus() as Promise<BackendStatus>;
}

export async function restartBackend(): Promise<{ success: boolean; state: string }> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC no disponible');
  }
  return window.electronAPI.backendRestart() as Promise<{ success: boolean; state: string }>;
}

// ─── API methods ───────────────────────────────────────────────────────────

export interface ProcessBody {
  files: string[];
  destino: string;
  formato: string;
  calidad: number;
  conversion_enabled?: boolean;
  resize_ancho: number | null;
  resize_alto: number | null;
  keep_exif: boolean;
  usar_rename: boolean;
  patron: string;
  secuencia: number;
  use_filename_seq: boolean;
  use_column_rename?: boolean;
  key_column?: string;
  mapping?: Record<string, string>;
  mapping_path?: string;
}

export interface PreviewBody {
  files: string[];
  patron: string;
  secuencia: number;
  use_filename_seq: boolean;
  key_column?: string;
  mapping?: Record<string, string>;
}

export interface PreviewImageBody {
  path: string;
  formato: string;
  calidad: number;
  resize?: number[] | null;
}

export interface TechnicalReportsListBody {
  cs?: string;
  contratista?: string;
  status?: string;
  summary?: boolean;
}

export interface TechnicalReportsImportBody {
  filename: string;
  content_b64: string;
}

export interface TechnicalReportsRenderBody {
  id?: string;
  report?: unknown;
  logo_left?: string | null;
  logo_right?: string | null;
}

export interface HtmlToPdfBody {
  html: string;
  filename: string;
  localImagePaths?: Record<string, string>;
  outputPath?: string;
}

export type HtmlToPdfResponse =
  | { pdf_base64: string; filename: string; saved_path?: never }
  | { pdf_base64?: never; filename: string; saved_path: string };

export type FormatosGenerateResponse =
  | { pdf_base64: string; filename: string; saved_path?: never }
  | { pdf_base64?: never; filename: string; saved_path: string };

export const api = {
  version: () => _invoke<{ version: string }>('version'),
  formats: () => _invoke<{ formats: string[] }>('formats'),

  dialogFiles: () => _invoke<{ paths: string[] }>('dialog_files'),
  dialogFolder: () => _invoke<{ paths: string[] }>('dialog_folder'),
  dialogDest: () => _invoke<{ paths: string[] }>('dialog_dest'),
  dialogSave: (params?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => _invoke<{ paths: string[] }>('dialog_save', params),

  startProcess: (body: ProcessBody) => _invoke<{ started: boolean }>('process_start', body),
  getStatus: () => _invoke<ProcessStatus>('process_status'),
  cancelProcess: () => _invoke<{ cancelled: boolean }>('process_cancel'),

  preview: (body: PreviewBody) => _invoke<{ preview: PreviewItem[]; collisions?: MappingCollision[] }>('preview', body),
  previewImage: (body: PreviewImageBody) =>
    _invoke<{ preview: string; width: string; height: string; orig_size_kb: string }>('preview_image', body),

  isVideo: (path: string) => _invoke<{ is_video: boolean }>('is_video', { path }),

  getRecords: () => _invoke<{ records: DBRecord[]; fields: string[] }>('db_records'),
  importExcel: (path: string) => _invoke<{ imported: number }>('db_import', { path }),
  exportExcel: (path: string) => _invoke<{ exported: number }>('db_export', { path }),
  generateTemplate: (path: string) => _invoke<{ path: string }>('db_template', { path }),
  generateMappingTemplate: (path: string) => _invoke<{ path: string }>('db_mapping_template', { path }),
  clearDatabase: () => _invoke<{ cleared: number }>('db_clear'),
  scanFolder: (folder: string) => _invoke<{ files: string[] }>('scan_folder', { folder }),

  getFields: () => _invoke<{ fields: DBField[] }>('db_fields'),
  updateFields: (fields: DBField[]) => _invoke<{ fields: DBField[] }>('db_fields_update', { fields }),
  resetFields: () => _invoke<{ fields: DBField[] }>('db_fields_reset'),

  getDbColumns: () => _invoke<{ columns: string[]; records: DBRecord[]; total: number }>('db_columns'),
  dbParseMapping: (path: string, files?: string[]) =>
    _invoke<MappingResult>('db_parse_mapping', { path, files: files ?? [] }),
  dbValidateMapping: (mapping: Record<string, string>, files?: string[]) =>
    _invoke<MappingResult>('db_validate_mapping', { mapping, files: files ?? [] }),

  getRenamePatterns: () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_get'),
  updateRenamePatterns: (patterns: RenamePattern[]) => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_update', { patterns }),
  resetRenamePatterns: () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_reset'),

  getTheme: () => _invoke<ThemeConfig>('theme_get'),
  saveTheme: (theme: ThemeConfig) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(theme)) {
      if (typeof v === 'string') safe[k] = v;
    }
    return _invoke<ThemeConfig>('theme_save', safe);
  },
  getPresets: () => _invoke<{ presets: string[] }>('theme_presets'),
  applyPreset: (name: string) => _invoke<ThemeConfig>('theme_preset', { name }),
  resetTheme: () => _invoke<ThemeConfig>('theme_reset'),

  historyList: (body?: { limit?: number; offset?: number; run_type?: string; date_from?: string; date_to?: string }) => _invoke<{ runs: unknown[] }>('history_list', body),
  historyGet: (id: number) => _invoke<{ run: unknown }>('history_get', { id }),
  historyDelete: (id: number) => _invoke<{ deleted: boolean }>('history_delete', { id }),
  historyDeleteMany: (ids: number[]) => _invoke<{ deleted: number; requested: number }>('history_delete_many', { ids }),
  historySave: (body: {
    files: string[];
    options: Record<string, unknown>;
    patron?: string;
    formato?: string;
    calidad?: number;
    resize?: string | null;
    ok_count?: number;
    err_count?: number;
    run_type: string;
    duration_ms?: number;
  }) => _invoke<{ id: number }>('history_save', body),
  historySchema: () => _invoke<{
    run_types: Array<{
      id: string;
      label_key: string;
      description_key: string;
      color_token: string;
      show_patron: boolean;
      filter_group: string;
      options_schema: Record<string, unknown>;
      files_schema: Record<string, unknown>;
      stats: Array<{ key: string; label_key: string; color_token: string | null }>;
    }>;
    all_run_types: string[];
    current_version: string;
  }>('history_schema', {}),
  historyExport: (body?: { ids?: number[]; run_type?: string; date_from?: string; date_to?: string; limit?: number }) =>
    _invoke<{ csv: string; count: number }>('history_export', body ?? {}),

  // ─── Formatos PDF ───────────────────────────────────────────────────────
  formatosList: () => _invoke<{ formats: FormatInfo[] }>('formatos_list'),
  formatosGenerate: (body: { format_id: string; desde: number; hasta: number; output_path?: string }) =>
    _invoke<FormatosGenerateResponse>('formatos_generate', body),
  formatosUpload: (body: { nombre: string; filename: string; content_b64: string; persisted?: boolean; filename_pattern?: string }) =>
    _invoke<{ format: FormatInfo }>('formatos_upload', body),
  formatosDelete: (format_id: string) => _invoke<{ deleted: boolean }>('formatos_delete', { format_id }),
  formatosUpdateMapping: (format_id: string, mapping: VisualMapping) =>
    _invoke<{ format: FormatInfo }>('formatos_update_mapping', { format_id, mapping }),

  // ─── Sellador ───────────────────────────────────────────────────────────
  selladorInspectPdf: (body: { pdf_path: string }) =>
    _invoke<{
      filename: string;
      page_count: number;
      page_width: number;
      page_height: number;
    }>('sellador_inspect_pdf', body),
  selladorRenderPage: (body: { pdf_path: string; page_num?: number; max_width?: number }) =>
    _invoke<{
      image_base64: string;
      page_width: number;
      page_height: number;
      mime_type: string;
    }>('sellador_render_page', body),
  selladorApply: (body: {
    pdf_b64?: string;
    pdf_path?: string;
    stamp_b64?: string;
    stamp_path?: string;
    stamp_count: number;
    x: number;
    y: number;
    width: number;
    height: number;
    seed?: number;
    filename?: string;
    output_path?: string;
    stamp_placements?: Array<{
      page_index: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }) => _invoke<{
    pdf_base64?: string;
    saved_path?: string;
    filename: string;
    stamp_count: number;
    stamped_pages: number[];
    page_assignments: number[];
    seed: number;
  }>('sellador_apply', body),
  selladorPreviewPages: (body: { page_count: number; stamp_count: number; seed?: number }) =>
    _invoke<{ page_assignments: number[]; stamped_pages: number[]; seed: number }>('sellador_preview_pages', body),

  // ─── Image Optimizer ────────────────────────────────────────────────────
  imageOptimizerZip: (body: { files: Array<{ filename: string; content_b64: string }>; zip_name: string; output_path?: string }) =>
    _invoke<{ zip_base64?: string; saved_path?: string; filename: string }>('image_optimizer_zip', body),

  // ─── Plantillas PreviewPanel ─────────────────────────────────────────────
  templatesList: () => _invoke<{ templates: Array<{ id: string; name: string; filename: string }> }>('templates_list'),
  templateGet: (name: string) => _invoke<{ name: string; content: string }>('template_get', { name }),

  // ─── Render HTML to PDF via Electron ─────────────────────────────────────
  htmlToPdf: (body: HtmlToPdfBody) =>
    _invoke<HtmlToPdfResponse>('html_to_pdf', {
      ...body,
      html: _sanitizeHtmlForPdf(body.html),
    }),

  // ─── Informes técnicos ─────────────────────────────────────────────────
  technicalReportsList: (body?: TechnicalReportsListBody) =>
    _invoke<{ reports: unknown[] }>('technical_reports_list', body),
  technicalReportsGet: (id: string) =>
    _invoke<{ report: unknown }>('technical_reports_get', { id }),
  technicalReportsCreate: (report?: unknown) =>
    _invoke<{ success: boolean; report: unknown }>('technical_reports_create', report ? { report } : {}),
  technicalReportsUpdate: (id: string, report: unknown) =>
    _invoke<{ success: boolean; report: unknown }>('technical_reports_update', { id, report }),
  technicalReportsDelete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('technical_reports_delete', { id }),
  technicalReportsClear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('technical_reports_clear'),
  technicalReportsImportFile: (body: TechnicalReportsImportBody) =>
    _invoke<{ success: boolean; message: string; deleted_count: number; imported_count: number; total_rows_in_file: number }>('technical_reports_import_file', body),
  technicalReportsVariables: () =>
    _invoke<{ variables: Array<{ key: string; label: string; category: string }> }>('technical_reports_variables'),
  technicalReportsAutocompleteCs: () =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_cs'),
  technicalReportsAutocompleteContratista: (cs?: string) =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_contratista', cs ? { cs } : {}),
  technicalReportsRenderHtml: (body: TechnicalReportsRenderBody) =>
    _invoke<{ html: string; filename: string }>('technical_reports_render_html', body),
  technicalReportsRenderConsolidatedHtml: (body?: { report_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    _invoke<{ html: string; filename: string; count: number }>('technical_reports_render_consolidated_html', body),

  // ─── Panel Aviso de Corte ──────────────────────────────────────────────
  panelAvisoCorteParseExcel: (body: { xlsx_b64: string; filename: string }) =>
    _invoke<{ columns: string[]; normalizedColumns: string[]; rows: Array<Record<string, string>>; warnings: string[] }>('panel_aviso_corte_parse_excel', body),
  panelAvisoCorteComputeMatch: (body: {
    rows: Array<Record<string, string>>;
    key_column: string;
    strategy: string;
    pattern?: string;
    address_column?: string;
    image_names: string[];
    export_mode: string;
  }) => _invoke<{ panels: unknown[]; summary: unknown; warnings: string[] }>('panel_aviso_corte_compute_match', body),
  panelAvisoCorteRenderPdf: (body: {
    panels: unknown[];
    logos: { left_b64?: string; right_b64?: string };
    images: Record<string, string>;
    image_paths?: Record<string, string>;
    format?: string;
  }) => _invoke<{ pdf_base64: string; filename: string }>('panel_aviso_corte_render_pdf', body),
  panelAvisoCorteTemplate: (body: { path: string }) => _invoke<{ path: string }>('panel_aviso_corte_template', body),
};
