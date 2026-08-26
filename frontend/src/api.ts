/**
 * API bridge: habla con el backend Python via Electron IPC (JSON-RPC)
 * en vez de HTTP fetch como en la arquitectura antigua (FastAPI+PyQt5).
 */

import type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision } from './types';
import type { PanelMatchResponse } from './components/panel-aviso-corte/types';

export type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision };

// Single source of truth for which methods get the extended IPC timeout.
// Shared with electron/ipc-methods.js via shared/long-running-methods.json so
// the renderer and main process cannot drift on timeout classification.
import longRunningMethods from '../../shared/long-running-methods.json';

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
      getPathForFile: (file: File) => string;
      registerLocalPath: (filePath: string) => Promise<unknown>;
      fileStagedCreate?: (name: string, size: number) => Promise<{ token: string }>;
      fileStagedAppend?: (token: string, chunk: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
      fileStagedComplete?: (token: string) => Promise<{ file_token: string }>;
      fileStagedAbort?: (token: string) => Promise<unknown>;
      cleanupFileToken?: (token: string) => Promise<{ cleaned: boolean }>;
      canvasAssetPut?: (chunk: ArrayBuffer | Uint8Array) => Promise<{ asset_id: string; ref: string; bytes: number }>;
      canvasAssetGet?: (ref: string) => Promise<{ ref: string; chunk: ArrayBuffer; bytes: number }>;
    };
  }
}

const IPC_TIMEOUT = 30_000;           // default timeout — most ops finish in <5s
const IPC_LONG_TIMEOUT = 900_000;     // 15 min for large PDF/ZIP/image batches
// Startup wait budget in Electron Main (waitForReady in ipc-router.js) is 60s.
// Renderer backstop must outlive Electron main's (STARTUP_WAIT_MS + REQUEST_TIMEOUT_MS)
// so main always handles/times-out the request and returns structured errors first.
const FE_STARTUP_BUFFER_MS = 60_000;
const FE_TIMEOUT_BUFFER_MS = 10_000;
// No frontend retry layer: the Electron main process (ipc-router._callBackend)
// already waits for backend readiness and retries transient mid-flight failures
// with waitForReady() between attempts. A second retry layer here multiplied
// transient errors into up to 9 attempts and added blind latency on top of the
// backend's informed recovery. The timeout race below stays as a backstop in
// case the main process itself hangs before the backend timeout fires.

export class AntaresAPIError extends Error {
  code: number;
  category: string;
  details?: Record<string, unknown>;

  constructor(message: string, code = -32000, category = 'INTERNAL_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'AntaresAPIError';
    this.code = code;
    this.category = category;
    this.details = details;
  }

  isResourceLockedError(): boolean {
    return this.code === -32002 || this.category === 'RESOURCE_LOCKED';
  }

  isValidationError(): boolean {
    return this.code === -32602 || this.category === 'VALIDATION_ERROR';
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseProcessStatus(raw: unknown): ProcessStatus {
  if (!raw || typeof raw !== 'object') {
    throw new AntaresAPIError('Respuesta process_status inválida', -32000, 'INTERNAL_ERROR');
  }
  const data = raw as Record<string, unknown>;
  const logsRaw = Array.isArray(data.logs) ? data.logs : [];
  return {
    running: asBoolean(data.running),
    progress: asNumber(data.progress),
    current_file: asString(data.current_file),
    ok_count: asNumber(data.ok_count),
    err_count: asNumber(data.err_count),
    logs: logsRaw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        message: asString(entry.message),
        tag: asString(entry.tag),
      })),
    id: typeof data.id === 'string' ? data.id : undefined,
    job_type: typeof data.job_type === 'string' ? data.job_type : undefined,
    total: typeof data.total === 'number' ? data.total : undefined,
    cancel_requested: typeof data.cancel_requested === 'boolean' ? data.cancel_requested : undefined,
    created_at: typeof data.created_at === 'string' ? data.created_at : undefined,
    params: data.params && typeof data.params === 'object' ? data.params as Record<string, unknown> : undefined,
    result: data.result === null
      ? null
      : (data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : undefined),
  };
}

const LONG_RUNNING_METHODS = new Set<string>(longRunningMethods);

/** Must match electron/ipc-router.js — structured fields survive only inside Error.message. */
const ANTARES_IPC_ERROR_PREFIX = 'ANTARES_IPC_ERROR:';
const ELECTRON_INVOKE_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

function stripElectronInvokePrefix(message: string): string {
  return message.replace(ELECTRON_INVOKE_PREFIX, '');
}

function antaresErrorFromPayload(raw: {
  message?: unknown;
  code?: unknown;
  category?: unknown;
  details?: unknown;
}, fallbackMessage: string): AntaresAPIError {
  return new AntaresAPIError(
    typeof raw.message === 'string' ? raw.message : fallbackMessage,
    typeof raw.code === 'number' ? raw.code : -32000,
    typeof raw.category === 'string' ? raw.category : 'INTERNAL_ERROR',
    raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
      ? raw.details as Record<string, unknown>
      : undefined,
  );
}

/** Recover structured IPC errors encoded by the main process (or plain-object rejects in tests). */
function parseIpcInvokeError(err: unknown): AntaresAPIError | null {
  if (err instanceof AntaresAPIError) return err;

  if (err instanceof Error) {
    const body = stripElectronInvokePrefix(err.message);
    if (body.startsWith(ANTARES_IPC_ERROR_PREFIX)) {
      try {
        const payload = JSON.parse(body.slice(ANTARES_IPC_ERROR_PREFIX.length)) as {
          message?: unknown;
          code?: unknown;
          category?: unknown;
          details?: unknown;
        };
        return antaresErrorFromPayload(payload, body);
      } catch {
        return new AntaresAPIError(body);
      }
    }
    return null;
  }

  // Plain object (unit tests; Electron itself does not deliver this shape).
  if (err && typeof err === 'object' && 'message' in err) {
    return antaresErrorFromPayload(
      err as { message?: unknown; code?: unknown; category?: unknown; details?: unknown },
      String(err),
    );
  }
  return null;
}

const _invoke = async <T>(method: string, params?: Record<string, unknown> | object): Promise<T> => {
  if (!window.electronAPI) {
    throw new AntaresAPIError('Electron IPC no disponible', -32000, 'INTERNAL_ERROR');
  }

  const timeoutMs =
    (LONG_RUNNING_METHODS.has(method) ? IPC_LONG_TIMEOUT : IPC_TIMEOUT) +
    FE_STARTUP_BUFFER_MS +
    FE_TIMEOUT_BUFFER_MS;
  // Single attempt: retry logic lives in ipc-router._callBackend (main process),
  // which can actually wait for the backend to recover. The timeout race is a
  // backstop for the case where the main process never resolves the invoke.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutErr = () => new AntaresAPIError(`IPC timeout: ${method}`, -32001, 'TIMEOUT');
  const invokePromise = window.electronAPI.invoke(method, params as Record<string, unknown>).then(
    (value) => {
      if (timedOut) throw timeoutErr();
      return value as T;
    },
    (err: unknown) => {
      if (timedOut) throw timeoutErr();
      throw err;
    },
  );
  invokePromise.catch(() => {});
  try {
    const result = await Promise.race<T>([
      invokePromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(timeoutErr());
        }, timeoutMs);
      }),
    ]);
    return result as T;
  } catch (err: unknown) {
    if (timedOut) throw timeoutErr();
    const parsed = parseIpcInvokeError(err);
    if (parsed) throw parsed;
    if (err instanceof Error) {
      throw new AntaresAPIError(stripElectronInvokePrefix(err.message));
    }
    throw new AntaresAPIError(String(err));
  } finally {
    // Limpiar el timer en éxito: sin esto el closure del setTimeout vive hasta
    // que dispara, goteando memoria en sesiones largas con muchos IPC calls.
    if (timer) clearTimeout(timer);
  }
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

export type SequenceMode = 'record' | 'global' | 'filename';

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
  id_column?: string;
  rename_column?: string;
  word_separator?: string;
  sequence_mode?: SequenceMode;
}

export interface PreviewBody {
  files: string[];
  patron: string;
  secuencia: number;
  use_filename_seq: boolean;
  word_separator?: string;
  key_column?: string;
  mapping?: Record<string, string>;
  mapping_path?: string;
  id_column?: string;
  rename_column?: string;
  sequence_mode?: SequenceMode;
  /** Carpeta de salida: el preview replica la dedupe del job contra archivos ya existentes ahí. */
  destino?: string;
}


export interface DbDetectKeyColumnResult {
  key_column: string;
  matches: number;
  columns: Array<{ name: string; matches: number }>;
}

export interface PreviewResult {
  preview: PreviewItem[];
  collisions?: MappingCollision[];
  detected_key_column?: string;
  detected_key_column_matches?: number;
  /** True when the backend capped the preview batch (see total_files). */
  truncated?: boolean;
  /** Full input file count before preview truncation. */
  total_files?: number;
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

export interface InformesV2ListBody {
  q?: string;
  status?: string;
  summary?: boolean;
}

export interface InformesV2ImportBody {
  filename: string;
  content_b64: string;
}

export interface InformesV2RenderBody {
  id?: string;
  report?: unknown;
  logo_left?: string | null;
  logo_right?: string | null;
  images?: Array<{ path: string; name?: string }>;
}

export interface FichasTecnicasListBody {
  cliente?: string;
  distrito?: string;
  status?: string;
  summary?: boolean;
}

export interface FichasTecnicasImportBody {
  filename: string;
  content_b64: string;
}

export interface FichasTecnicasRenderBody {
  id?: string;
  ficha?: unknown;
  template?: boolean;
  logo_left?: string | null;
  logo_right?: string | null;
}

export interface HtmlToPdfBody {
  html: string;
  filename: string;
  localImagePaths?: Record<string, string>;
  outputPath?: string;
  /** Opt-in: inline PDF as base64 (prefer outputPath / saved_path for large exports). */
  return_base64?: boolean;
}

export interface CanvasExportCmykPdfBody {
  document: import('./components/canvas/types').CanvasDocument;
  contexts?: unknown[];
  /** When true, render context[i] with page i (1:1) instead of cartesian product. */
  pair_context_pages?: boolean;
  color_profile?: string;
  dpi?: number;
  bleed_mm?: number;
  show_crop_marks?: boolean;
  filename?: string;
  outputPath?: string;
  localImagePaths?: Record<string, string>;
}

export type HtmlToPdfResponse =
  | { pdf_base64: string; filename: string; saved_path?: never }
  | { pdf_base64?: never; filename: string; saved_path: string };

export type FormatosGenerateResponse =
  | { pdf_base64: string; filename: string; saved_path?: never }
  | { pdf_base64?: never; filename: string; saved_path: string };

export interface ImageOptimizerSaveFileEntry {
  filename: string;
  path: string;
}

export interface ImageOptimizerSaveSkippedEntry {
  filename: string;
  reason: string;
}

export interface ImageOptimizerSaveFilesResponse {
  saved_path: string;
  saved_count: number;
  skipped_count: number;
  saved: ImageOptimizerSaveFileEntry[];
  skipped: ImageOptimizerSaveSkippedEntry[];
}

export const api = {
  version: () => _invoke<{ version: string }>('version'),
  formats: () => _invoke<{ formats: string[] }>('formats'),

  dialogFiles: () => _invoke<{ paths: string[] }>('dialog_files'),
  dialogDest: () => _invoke<{ paths: string[] }>('dialog_dest'),
  dialogFolder: (params?: { title?: string; pickOnly?: boolean }) =>
    _invoke<{ paths: string[]; folder?: string }>('dialog_folder', params),
  dialogSave: (params?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => _invoke<{ paths: string[] }>('dialog_save', params),

  /** Display-size local thumbnail via Electron nativeImage (Path A). */
  localThumbnail: (body: { path: string; maxEdge?: number }) =>
    _invoke<{ dataUrl: string }>('local_thumbnail', body),

  /** Full-fidelity allowlisted local image → data URL (CSP-safe; no file://). */
  localImageDataUrl: (body: { path: string }) =>
    _invoke<{ dataUrl: string }>('local_image_data_url', body),

  startProcess: (body: ProcessBody) =>
    _invoke<{ started: boolean; reason?: string; job_id?: string }>('process_start', body),

  getStatus: async () => parseProcessStatus(await _invoke<unknown>('process_status')),
  cancelProcess: () => _invoke<{ cancelled: boolean }>('process_cancel'),

  preview: (body: PreviewBody) => _invoke<PreviewResult>('preview', body),

  dbDetectKeyColumn: (files: string[]) => _invoke<DbDetectKeyColumnResult>('db_detect_key_column', { files }),

  getRecords: (opts?: { limit?: number; offset?: number }) =>
    _invoke<{ records: DBRecord[]; fields: string[]; limit: number; offset: number }>(
      'db_records',
      opts ?? {},
    ),
  importExcel: (path: string) =>
    _invoke<{ imported: number; inserted?: number; skipped?: number }>('db_import', { path }),
  clearDatabase: () => _invoke<{ cleared: number }>('db_clear'),

  getFields: () => _invoke<{ fields: DBField[] }>('db_fields'),
  updateFields: (fields: DBField[]) => _invoke<{ fields: DBField[] }>('db_fields_update', { fields }),
  resetFields: () => _invoke<{ fields: DBField[] }>('db_fields_reset'),

  getDbColumns: () => _invoke<{ columns: string[]; records: DBRecord[]; total: number }>('db_columns'),
  dbParseMapping: (path: string, files?: string[], id_column?: string, rename_column?: string) =>
    _invoke<MappingResult>('db_parse_mapping', { path, files: files ?? [], id_column, rename_column }),

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

  // ─── Formatos PDF ───────────────────────────────────────────────────────
  formatosList: () => _invoke<{ formats: FormatInfo[] }>('formatos_list'),
  formatosGenerate: (body: { format_id: string; desde: number; hasta: number; output_path?: string }) =>
    _invoke<FormatosGenerateResponse>('formatos_generate', body),
  formatosUpload: (body: { nombre: string; filename: string; content_b64: string; persisted?: boolean; filename_pattern?: string }) =>
    _invoke<{ format: FormatInfo }>('formatos_upload', body),
  formatosDelete: (format_id: string) => _invoke<{ deleted: boolean }>('formatos_delete', { format_id }),
  formatosGetTemplate: (format_id: string) =>
    _invoke<{ pdf_base64: string; filename: string }>('formatos_get_template', { format_id }),
  formatosRenderTemplatePage: (body: { format_id: string; page_num?: number; max_width?: number }) =>
    _invoke<{
      image_base64: string;
      page_width: number;
      page_height: number;
      mime_type: string;
    }>('formatos_render_template_page', body),
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

  // ─── Image Optimizer ────────────────────────────────────────────────────
  imageOptimizerZip: (body: { files: Array<{ filename: string; content_b64: string }>; zip_name: string; output_path?: string }) =>
    _invoke<{ zip_base64?: string; saved_path?: string; filename: string }>('image_optimizer_zip', body),
  imageOptimizerSaveFiles: (body: { files: Array<{ filename: string; content_b64: string }>; output_folder: string }) =>
    _invoke<ImageOptimizerSaveFilesResponse>('image_optimizer_save_files', body),

  // ─── Plantillas PreviewPanel ─────────────────────────────────────────────
  templatesList: () =>
    _invoke<{ templates: Array<{ id: string; name: string; filename: string; source?: string }> }>('templates_list'),
  templateGet: (name: string) =>
    _invoke<{ name: string; content: string; source?: string }>('template_get', { name }),

  // ─── Canvas (independent template editor) ────────────────────────────────
  canvasList: () =>
    _invoke<{ documents: Array<{ id: string; name: string; updatedAt?: string }> }>('canvas_list'),
  canvasGet: (id: string) => _invoke<{ document: import('./components/canvas/types').CanvasDocument }>('canvas_get', { id }),
  canvasSave: (
    document: import('./components/canvas/types').CanvasDocument,
    opts?: { touch?: boolean },
  ) =>
    _invoke<{ document: import('./components/canvas/types').CanvasDocument }>('canvas_save', {
      document,
      ...(opts?.touch === false ? { touch: false } : {}),
    }),
  canvasCreate: (name?: string) =>
    _invoke<{ document: import('./components/canvas/types').CanvasDocument }>('canvas_create', name ? { name } : {}),
  canvasDelete: (id: string) => _invoke<{ success: boolean; deleted_id: string }>('canvas_delete', { id }),
  canvasDuplicate: (id: string, name?: string) =>
    _invoke<{ document: import('./components/canvas/types').CanvasDocument }>('canvas_duplicate', name ? { id, name } : { id }),
  canvasExportCmykPdf: (body: CanvasExportCmykPdfBody) =>
    _invoke<HtmlToPdfResponse>('canvas_export_cmyk_pdf', body),
  canvasGetHistory: (id: string) =>
    _invoke<{ past: import('./components/canvas/utils/canvasDiff').HistoryStep[]; future: import('./components/canvas/utils/canvasDiff').HistoryStep[] }>('canvas_get_history', { id }),
  canvasSaveHistory: (id: string, past: import('./components/canvas/utils/canvasDiff').HistoryStep[], future: import('./components/canvas/utils/canvasDiff').HistoryStep[]) =>
    _invoke<{ success: boolean }>('canvas_save_history', { id, past, future }),

  spreadsheetParse: async (
    body: { file_token?: string | null; path?: string; format_hint?: string },
    opts?: { hydrate?: boolean },
  ) => {
    const res = await _invoke<{
      workbookName: string;
      sheets: Array<{ name: string; rows: unknown[][] }>;
      warnings: string[];
      result_file_token?: string;
      sheet_meta?: Array<{ name: string; rowCount: number }>;
    }>('spreadsheet_parse', body as unknown as Record<string, unknown>);
    if (!res.result_file_token) return res;
    if (opts?.hydrate === false) {
      return res;
    }
    const spilled = await _invoke<{
      workbookName: string;
      sheets: Array<{ name: string; rows: unknown[][] }>;
      warnings: string[];
    }>('file_token_read_json', { token: res.result_file_token });
    return {
      workbookName: spilled.workbookName || res.workbookName,
      sheets: spilled.sheets || [],
      warnings: [...(res.warnings || []), ...(spilled.warnings || [])],
      result_file_token: res.result_file_token,
      sheet_meta: res.sheet_meta,
    };
  },
  spreadsheetGetRows: (body: {
    result_file_token?: string;
    cache_token?: string;
    sheet?: string;
    sheet_index?: number;
    offset?: number;
    limit?: number;
  }) =>
    _invoke<{
      name: string;
      rows: unknown[][];
      offset: number;
      limit: number;
      total: number;
      has_more: boolean;
    }>('spreadsheet_get_rows', body as unknown as Record<string, unknown>),
  /** Drop a spill/result file token early (Preview hydrate:false path). */
  fileTokenCleanup: (token: string) =>
    _invoke<{ cleaned: boolean }>('file_token_cleanup', { token }),
  spreadsheetExportVolantesTemplate: (body?: { output_path?: string }) =>
    _invoke<{ content_b64: string; filename: string; path?: string }>('spreadsheet_export_volantes_template', (body || {}) as unknown as Record<string, unknown>),

  // ─── Render HTML to PDF via Electron ─────────────────────────────────────
  // Sanitization happens once, in Electron's renderHtmlToPdf (defense in depth
  // at the trust boundary), so the renderer just forwards the raw HTML.
  htmlToPdf: (body: HtmlToPdfBody) =>
    _invoke<HtmlToPdfResponse>('html_to_pdf', body),

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
  technicalReportsAutocompleteCs: () =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_cs'),
  technicalReportsAutocompleteContratista: (cs?: string) =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_contratista', cs ? { cs } : {}),
  technicalReportsRenderHtml: (body: TechnicalReportsRenderBody) =>
    _invoke<{ html: string; filename: string }>('technical_reports_render_html', body),
  technicalReportsRenderConsolidatedHtml: (body?: { report_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    _invoke<{ html: string; filename: string; count: number }>('technical_reports_render_consolidated_html', body),

  // ─── Informes v2 ───────────────────────────────────────────────────────
  informesV2List: (body?: InformesV2ListBody) =>
    _invoke<{ reports: unknown[] }>('informes_v2_list', body),
  informesV2Get: (id: string) =>
    _invoke<{ report: unknown }>('informes_v2_get', { id }),
  informesV2Create: (report?: unknown) =>
    _invoke<{ success: boolean; report: unknown }>('informes_v2_create', report ? { report } : {}),
  informesV2Update: (id: string, report: unknown) =>
    _invoke<{ success: boolean; report: unknown }>('informes_v2_update', { id, report }),
  informesV2Delete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('informes_v2_delete', { id }),
  informesV2Clear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('informes_v2_clear'),
  informesV2ImportFile: (body: InformesV2ImportBody) =>
    _invoke<{ success: boolean; message: string; deleted_count: number; imported_count: number; total_rows_in_file: number }>('informes_v2_import_file', body),
  informesV2DownloadTemplate: () =>
    _invoke<{ filename: string; content_b64: string; mime: string }>('informes_v2_download_template'),
  informesV2RenderHtml: (body: InformesV2RenderBody) =>
    _invoke<{ html: string; filename: string }>('informes_v2_render_html', body),
  informesV2RenderConsolidatedHtml: (body?: {
    report_ids?: string[];
    logo_left?: string | null;
    logo_right?: string | null;
    images_by_id?: Record<string, Array<{ path: string; name?: string }>>;
  }) =>
    _invoke<{ html: string; filename: string; count: number }>('informes_v2_render_consolidated_html', body),

  // ─── Fichas Técnicas ───────────────────────────────────────────────────
  fichasTecnicasList: (body?: FichasTecnicasListBody) =>
    _invoke<{ fichas: unknown[]; total: number }>('fichas_tecnicas_list', body),
  fichasTecnicasGet: (id: string) =>
    _invoke<{ ficha: unknown }>('fichas_tecnicas_get', { id }),
  fichasTecnicasCreate: (ficha?: unknown) =>
    _invoke<{ success: boolean; ficha: unknown }>('fichas_tecnicas_create', ficha ? { ficha } : {}),
  fichasTecnicasUpdate: (id: string, ficha: unknown) =>
    _invoke<{ success: boolean; ficha: unknown }>('fichas_tecnicas_update', { id, ficha }),
  fichasTecnicasDelete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('fichas_tecnicas_delete', { id }),
  fichasTecnicasClear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('fichas_tecnicas_clear'),
  fichasTecnicasImportFile: (body: FichasTecnicasImportBody) =>
    _invoke<{ success: boolean; message: string; deleted_count: number; imported_count: number; total_rows_in_file: number }>('fichas_tecnicas_import_file', body),
  fichasTecnicasRenderHtml: (body: FichasTecnicasRenderBody) =>
    _invoke<{ html: string; filename: string }>('fichas_tecnicas_render_html', body),
  fichasTecnicasRenderConsolidatedHtml: (body?: { ficha_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    _invoke<{ html: string; filename: string; count: number }>('fichas_tecnicas_render_consolidated_html', body),

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
  }) => _invoke<PanelMatchResponse>('panel_aviso_corte_compute_match', body),
  panelAvisoCorteRenderPdf: (body: {
    panels: unknown[];
    logos: { left_b64?: string; right_b64?: string };
    images: Record<string, string>;
    image_paths?: Record<string, string>;
    format?: string;
    template_id?: string;
    output_path?: string;
    export_mode?: string;
  }) => _invoke<{ pdf_base64: string; content_base64?: string; saved_path?: string; filename: string; format?: string; mime_type?: string }>('panel_aviso_corte_render_pdf', body),
  panelAvisoCorteTemplate: (body: { path: string; overwrite?: boolean }) => _invoke<{ path: string }>('panel_aviso_corte_template', body),

  // ─── Evidencia Volanteo ───────────────────────────────────────────────
  evidenciaVolanteoRender: (body: {
    title: string;
    cuadrante: string;
    cuadrante_label?: string;
    show_cuadrante_label?: boolean;
    pages: Array<{ cuadrante?: string; images: Array<{ filename: string; position: number }> }>;
    logos: { left_b64?: string; right_b64?: string };
    images?: Record<string, string>;
    image_paths?: Record<string, string>;
    html?: string;
    format?: string;
    output_path?: string;
  }) => _invoke<{ pdf_base64: string; content_base64?: string; saved_path?: string; filename: string; format?: string; mime_type?: string }>('evidencia_volanteo_render', body),

  // ─── Ubicaciones ──────────────────────────────────────────────────────
  /**
   * `excelPath` is either a staged read token (`antares-read-*`, obtained via
   * `stageFileForIpc`) or null for manual-data mode. Raw absolute paths are
   * rejected by the IPC router — do not send `getPathForFile` results here.
   */
  previewUbicacion: (body: {
    excelPath: string | null;
    formato: string;
    rowIndex: number;
    recomposeOnly?: boolean;
    provider?: string;
    api_key?: string;
    zoom?: number;
    customStyles?: Record<string, unknown>;
    manualData?: Record<string, any>;
  }) => _invoke<{ success: boolean; data?: unknown; error?: string }>('preview_ubicacion', body),
  generarUbicaciones: (body: {
    excelPath: string | null;
    outputDir: string;
    formato: string;
    consolidado: boolean;
    provider?: string;
    api_key?: string;
    zoom?: number;
    customStyles?: Record<string, unknown>;
    manualData?: Record<string, any>;
  }) => _invoke<{ success: boolean; data?: unknown; error?: string }>('generar_ubicaciones', body),
  ubicacionesKeysGet: () =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_get'),
  ubicacionesKeysSet: (keys: Record<string, string>) =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_set', { keys }),

  // ─── AutoIMG (Google Sheets + Drive — Electron main) ───────────────────
  autoimgOAuthConfigStatus: () => _invoke<{ configured: boolean; client_id_masked?: string }>('autoimg_oauth_config_status'),
  autoimgOAuthConfigSave: (client_id: string, client_secret: string) =>
    _invoke<{ success: boolean }>('autoimg_oauth_config_save', { client_id, client_secret }),
  autoimgSheetsAuthUrl: () => _invoke<{ url: string; redirect_uri: string }>('autoimg_sheets_auth_url'),
  autoimgSheetsAuthCancel: () => _invoke<{ success: boolean }>('autoimg_sheets_auth_cancel'),
  autoimgSheetsAuthStatus: () => _invoke<{ authenticated: boolean; email?: string }>('autoimg_sheets_auth_status'),
  autoimgSheetsAuthRevoke: () => _invoke<{ success: boolean }>('autoimg_sheets_auth_revoke'),
  autoimgSheetsOpen: (sheet_id: string) => _invoke<{ success: boolean; sheet_id?: string; name?: string; sheets?: string[]; created_tabs?: string[] }>('autoimg_sheets_open', { sheet_id }),
  autoimgSheetsGetConfig: () => _invoke<{ sheet_id: string; name: string; linked: boolean }>('autoimg_sheets_get_config'),
  autoimgSheetsReadRange: (range: string) => _invoke<{ values: string[][] }>('autoimg_sheets_read_range', { range }),
  autoimgSheetsWriteRange: (range: string, values: string[][]) => _invoke<{ updated: number }>('autoimg_sheets_write_range', { range, values }),
  autoimgSheetsAppendRow: (range: string, values: string[]) => _invoke<{ row: number }>('autoimg_sheets_append_row', { range, values }),
  autoimgDriveListFolder: (folder_id: string) => _invoke<{ files: Array<{ name: string; id: string; modifiedTime: string }> }>('autoimg_drive_list_folder', { folder_id }),
  autoimgDriveScanNis: (folder_id: string, folder_name?: string) => _invoke<{ nis_map: Record<string, { count: number; files: unknown[] }> }>('autoimg_drive_scan_nis', { folder_id, folder_name }),
  autoimgDriveVerifyFolder: (urlOrId: string) => _invoke<{ accessible: boolean; folder_id: string; name: string; image_count: number; sample_files: string[] }>('autoimg_drive_verify_folder', { url: urlOrId }),
  autoimgDriveFolderPreview: (folder_id: string, force = false) =>
    _invoke<{
      folder_id: string;
      thumbs: Array<{ id: string; name: string; dataUrl: string | null }>;
    }>('autoimg_drive_folder_preview', { folder_id, force }),
  autoimgDriveStatus: () => _invoke<{ connected: boolean }>('autoimg_drive_status'),
  autoimgFoldersList: (force = false) => _invoke<{ folders: Array<{ name: string; folder_id: string; activo: boolean; ultimo_scan: string; cant_archivos: number }>; cached?: boolean }>('autoimg_folders_list', { force }),
  autoimgFoldersAdd: (body: { name: string; folder_id: string; activo: boolean }) => _invoke<{ success: boolean }>('autoimg_folders_add', body),
  autoimgFoldersRemove: (body: { folder_id: string }) => _invoke<{ success: boolean }>('autoimg_folders_remove', body),
  autoimgFoldersToggle: (body: { folder_id: string; activo: boolean }) => _invoke<{ success: boolean }>('autoimg_folders_toggle', body),
  autoimgScanAndSync: () => _invoke<{
    success: boolean;
    updated: number;
    matched?: number;
    unmatched_scan?: number;
    new_rows: number;
    duplicate_nis?: number;
    logs: string[];
    folder_errors: number;
    scan: {
      summary: {
        total: number;
        completos: number;
        faltantes: number;
        sobrantes: number;
        fuera_padron: number;
        /** @deprecated alias de fuera_padron */
        sin_sgio?: number;
      };
      folders_failed: number;
    };
  }>('autoimg_scan_and_sync'),
  autoimgSyncToSheet: () => _invoke<{
    success: boolean;
    updated: number;
    matched?: number;
    unmatched_scan?: number;
    new_rows: number;
    duplicate_nis?: number;
    logs: string[];
  }>('autoimg_sync_to_sheet'),
  autoimgSyncFromSheet: () => _invoke<{ success: boolean; rows: string[][]; arrastre?: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }> }>('autoimg_sync_from_sheet'),
  autoimgRenameExport: (body: { dest_folder_id: string; only_completos?: boolean }) =>
    _invoke<{
      success: boolean;
      dest_folder_id: string;
      dest_name: string;
      destinos: string[];
      folders_created: string[];
      planned: number;
      copied: Array<{
        nis: string;
        sgio: string;
        destino?: string;
        slot: number;
        from: string;
        to: string;
        folder?: string;
        file_id: string;
      }>;
      failed: Array<{
        nis: string;
        sgio: string;
        destino?: string;
        from: string;
        to: string;
        error: string;
      }>;
      skipped: Array<{
        nis: string;
        sgio?: string;
        destino?: string;
        reason: string;
        detail?: string;
      }>;
      scan_summary?: {
        total: number;
        completos: number;
        faltantes: number;
        sobrantes: number;
        sin_sgio: number;
      };
    }>('autoimg_rename_export', body),
  autoimgRenameDestConfig: () => _invoke<{ folder_id: string }>('autoimg_rename_dest_config'),
  autoimgArrastreList: (force = false) => _invoke<{ entries: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }>; cached?: boolean }>('autoimg_arrastre_list', { force }),
  autoimgLogsList: (force = false) => _invoke<{ values: string[][]; cached?: boolean }>('autoimg_logs_list', { force }),
  autoimgBootstrap: (refresh = true) => _invoke<{
    connected: boolean;
    sheetName?: string;
    sheetId?: string;
    sheetLinked?: boolean;
    lastSync?: string;
    autoSync: boolean;
    totalNis?: number;
    completos?: number;
    faltantes?: number;
    sobrantes?: number;
    sinSgio?: number;
    carpetasActivas?: number;
    folders: Array<{ name: string; folder_id: string; activo: boolean; ultimo_scan: string; cant_archivos: number }>;
    bdRows: string[][];
    logRows: string[][];
    arrastre: Array<{ nis: string; sgio: string; motivo: string; fecha: string; observacion: string }>;
    error?: string;
    error_code?: string;
    stale?: boolean;
    cached?: boolean;
  }>('autoimg_bootstrap', { refresh }),
  autoimgAutoSyncToggle: (enabled: boolean) => _invoke<{ enabled: boolean }>('autoimg_auto_sync_toggle', { enabled }),
  autoimgCancelOperation: () => _invoke<{ success: boolean; operation?: string; reason?: string }>('autoimg_cancel_operation'),
  autoimgStatus: () => _invoke<{ connected: boolean; sheetName?: string; sheetId?: string; sheetLinked?: boolean; lastSync?: string; autoSync: boolean; totalNis?: number; completos?: number; faltantes?: number; sobrantes?: number; sinSgio?: number; carpetasActivas?: number }>('autoimg_status'),

  // ─── RUM Telemetry (web-vitals → stderr) ────────────────────────────────
  telemetry: (body: {
    name: string;
    value: number;
    rating?: string;
    delta?: number;
    id?: string;
    navigationType?: string;
    url?: string;
    timestamp?: number;
  }) => _invoke<{ ok: boolean }>('telemetry', body as unknown as Record<string, unknown>),

};
