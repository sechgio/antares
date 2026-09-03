
import type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision } from './types';
import type { PanelMatchResponse, PanelVM } from './components/panel-aviso-corte/types';
import type { FichaTecnica, FichaTecnicaListItem } from './components/fichas-tecnicas/types';
import type { TechnicalReport, TechnicalReportListItem } from './components/technical-reports/types';
import type { InformeV2, InformeV2ListItem } from './components/informes-v2/types';
import type { HistoryRunRow } from './components/history/runTypes';
import type { AutoImgFolder } from './components/autoimg/types';
import { createAutoimgApi } from './api/autoimgApi';

export type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy, MappingResult, MappingCollision, AutoImgFolder };

import longRunningMethods from '../../shared/long-running-methods.json';
import heavyIpcMethods from '../../shared/heavy-ipc-methods.json';

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
      registerFileInputPath?: (filePath: string) => boolean;
      canvasFlushAck?: () => Promise<unknown>;
      fileStagedCreate?: (name: string, size: number) => Promise<{ token: string }>;
      fileStagedAppend?: (token: string, chunk: ArrayBuffer | Uint8Array | string) => Promise<unknown>;
      fileStagedComplete?: (token: string) => Promise<{ file_token: string }>;
      fileStagedAbort?: (token: string) => Promise<unknown>;
      resolveFileToken?: (token: string) => Promise<{ path: string; name?: string; size?: number }>;
      cleanupFileToken?: (token: string) => Promise<{ cleaned: boolean }>;
      canvasAssetPut?: (chunk: ArrayBuffer | Uint8Array) => Promise<{ asset_id: string; ref: string; bytes: number }>;
      canvasAssetGet?: (ref: string) => Promise<{ ref: string; chunk: ArrayBuffer; bytes: number }>;
      canvasAssetGc?: () => Promise<{ collected: number; bytes_freed: number }>;
      reportRendererError?: (report: Record<string, unknown>) => Promise<unknown>;
      reportRendererEvent?: (event: string, fields?: Record<string, unknown>, level?: string) => void;
    };
  }
}

const IPC_TIMEOUT = 30_000;
const IPC_LONG_TIMEOUT = 300_000;
const IPC_HEAVY_TIMEOUT = 900_000;
const FE_STARTUP_BUFFER_MS = 60_000;
const FE_TIMEOUT_BUFFER_MS = 10_000;

export type APIErrorCategory =
  | 'INTERNAL_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'RESOURCE_LOCKED'
  | 'TIMEOUT'
  | 'MEMORY_PRESSURE'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_FOUND'
  | 'AUTHENTICATION_ERROR'
  | 'RENDERING_ERROR';

export class AntaresAPIError extends Error {
  code: number;
  category: APIErrorCategory | string;
  details?: Record<string, unknown>;

  constructor(message: string, code = -32000, category: APIErrorCategory | string = 'INTERNAL_ERROR', details?: Record<string, unknown>) {
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

  isMemoryPressureError(): boolean {
    return this.code === -32003 || this.category === 'MEMORY_PRESSURE';
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
const HEAVY_IPC_METHODS = new Set<string>(heavyIpcMethods);

const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry<T> = { value: T; expires: number; promise?: Promise<T> };
const _cache = new Map<string, CacheEntry<any>>();
const _cacheGenerations = new Map<string, number>();
function cachedInvoke<T>(key: string, fn: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<T> {
  const now = Date.now();
  const generation = _cacheGenerations.get(key) ?? 0;
  const hit = _cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && hit.expires > now) return Promise.resolve(hit.value);
  const p = fn()
    .then((v) => {
      if ((_cacheGenerations.get(key) ?? 0) === generation) {
        _cache.set(key, { value: v, expires: now + ttl });
      }
      return v;
    })
    .finally(() => {
      const e = _cache.get(key);
      if (e?.promise === p) delete (e as { promise?: Promise<T> }).promise;
    });
  _cache.set(key, { value: undefined, expires: 0, promise: p } as unknown as CacheEntry<T>);
  return p;
}
export function invalidateApiCache(key?: string) {
  if (key) {
    _cacheGenerations.set(key, (_cacheGenerations.get(key) ?? 0) + 1);
    _cache.delete(key);
    return;
  }
  for (const cacheKey of _cache.keys()) {
    _cacheGenerations.set(cacheKey, (_cacheGenerations.get(cacheKey) ?? 0) + 1);
  }
  _cache.clear();
}

function invalidateDatabaseCaches() {
  invalidateApiCache('db_fields');
  invalidateApiCache('db_columns');
}

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

  const baseTimeout = HEAVY_IPC_METHODS.has(method)
    ? IPC_HEAVY_TIMEOUT
    : LONG_RUNNING_METHODS.has(method)
      ? IPC_LONG_TIMEOUT
      : IPC_TIMEOUT;
  const timeoutMs = baseTimeout + FE_STARTUP_BUFFER_MS + FE_TIMEOUT_BUFFER_MS;
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
    if (timer) clearTimeout(timer);
  }
};

export function onNotify(callback: (method: string, params: unknown) => void) {
  if (!window.electronAPI) return () => {};
  return window.electronAPI.onNotify(callback);
}

export interface BackendHealthStatus {
  last_probe_at: string | null;
  last_success_at: string | null;
  last_probe_ms: number | null;
  last_probe_outcome: string | null;
  consecutive_failures: number;
  skipped_total: number;
  last_skip_reason: string | null;
  last_failure_at: string | null;
}

export interface BackendStatus {
  state: string;
  ready: boolean;
  lastError: { kind: string; message: string; stderrTail: string } | null;
  stderrTail: string;
  health?: BackendHealthStatus;
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
  destino?: string;
}

export interface FileDialogResult {
  paths: string[];
  file_tokens: string[];
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
  truncated?: boolean;
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
  report?: Partial<TechnicalReport>;
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
  report?: Partial<InformeV2>;
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
  ficha?: Partial<FichaTecnica>;
  template?: boolean;
  logo_left?: string | null;
  logo_right?: string | null;
}

export interface UbicacionManualData {
  cod_componente: string;
  lat: number | string;
  lon: number | string;
  direccion?: string;
  localidad?: string;
  distrito?: string;
}

export interface PreviewUbicacionParams {
  excelPath: string | null;
  formato: string;
  rowIndex: number;
  recomposeOnly?: boolean;
  provider?: string;
  api_key?: string;
  zoom?: number;
  customStyles?: Record<string, unknown>;
  manualData?: UbicacionManualData;
}

export interface PreviewUbicacionData {
  image: string;
  image_path?: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  datos: {
    cod_componente: string;
    lat: number;
    lon: number;
    direccion: string;
    localidad: string;
    distrito: string;
  };
  row_index: number;
  total_filas: number;
  formato: string;
}

export type PreviewUbicacionResponse = PreviewUbicacionData;

export interface GenerarUbicacionesParams {
  excelPath: string | null;
  outputDir: string;
  formato: string;
  consolidado: boolean;
  provider?: string;
  api_key?: string;
  zoom?: number;
  customStyles?: Record<string, unknown>;
  manualData?: UbicacionManualData;
}

export interface GenerarUbicacionesData {
  generados: number;
  fallidos: number;
  outputDir: string;
  consolidado: boolean;
  consolidatedPath: string | null;
}

export type GenerarUbicacionesResponse = GenerarUbicacionesData;

export interface HtmlToPdfBody {
  html: string;
  filename: string;
  localImagePaths?: Record<string, string>;
  outputPath?: string;
  canvas_manifest_b64?: string;
  return_base64?: boolean;
}

export interface CanvasExportCmykPdfBody {
  document: import('./components/canvas/types').CanvasDocument;
  contexts?: unknown[];
  pair_context_pages?: boolean;
  color_profile?: string;
  dpi?: number;
  bleed_mm?: number;
  show_crop_marks?: boolean;
  filename?: string;
  outputPath?: string;
  localImagePaths?: Record<string, string>;
  canvas_manifest_b64?: string;
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
  formats: () => cachedInvoke('formats', () => _invoke<{ formats: string[] }>('formats')),
  diagnosticsSnapshot: (params?: Record<string, unknown>) =>
    _invoke<Record<string, unknown>>('diagnostics_snapshot', params ?? {}),

  dialogFiles: () => _invoke<FileDialogResult>('dialog_files'),
  dialogDest: () => _invoke<{ paths: string[] }>('dialog_dest'),
  dialogFolder: (params?: { title?: string; pickOnly?: boolean }) =>
    _invoke<FileDialogResult & { folder?: string }>('dialog_folder', params),
  dialogSave: (params?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => _invoke<{ paths: string[] }>('dialog_save', params),

  localThumbnail: (body: { path?: string; file_token?: string; maxEdge?: number }) =>
    _invoke<{ dataUrl: string }>('local_thumbnail', body),

  localImageDataUrl: (body: { path?: string; file_token?: string }) =>
    _invoke<{ dataUrl: string }>('local_image_data_url', body),

  startProcess: (body: ProcessBody) =>
    _invoke<{ started: boolean; reason?: string; job_id?: string }>('process_start', body),

  getStatus: async () => parseProcessStatus(await _invoke<unknown>('process_status')),
  cancelProcess: () => _invoke<{ cancelled: boolean }>('process_cancel'),

  preview: (body: PreviewBody) => _invoke<PreviewResult>('preview', body),
  isVideo: (path: string) => _invoke<{ is_video: boolean }>('is_video', { path }),

  importExcel: (path: string) =>
    _invoke<{ imported: number; inserted?: number; skipped?: number }>('db_import', { path }).then((v) => {
      invalidateDatabaseCaches();
      return v;
    }),
  dbExport: (path: string) => _invoke<{ exported: number }>('db_export', { path }),
  dbTemplate: (path: string) => _invoke<{ path: string }>('db_template', { path }),
  clearDatabase: () =>
    _invoke<{ cleared: number }>('db_clear').then((v) => {
      invalidateApiCache('db_columns');
      return v;
    }),

  getFields: () => cachedInvoke('db_fields', () => _invoke<{ fields: DBField[] }>('db_fields')),
  updateFields: (fields: DBField[]) =>
    _invoke<{ fields: DBField[] }>('db_fields_update', { fields }).then((v) => {
      invalidateDatabaseCaches();
      return v;
    }),
  resetFields: () =>
    _invoke<{ fields: DBField[] }>('db_fields_reset').then((v) => {
      invalidateDatabaseCaches();
      return v;
    }),

  getDbColumns: () => cachedInvoke('db_columns', () => _invoke<{ columns: string[]; records: DBRecord[]; total: number }>('db_columns')),
  dbParseMapping: (path: string, files?: string[], id_column?: string, rename_column?: string) =>
    _invoke<MappingResult>('db_parse_mapping', { path, files: files ?? [], id_column, rename_column }),
  dbValidateMapping: (mapping: Record<string, string>, files: string[]) =>
    _invoke<{ valid: boolean; mapped_count: number; unmapped_files: string[]; missing_keys: string[] }>('db_validate_mapping', { mapping, files }),

  getRenamePatterns: () => cachedInvoke('rename_patterns_get', () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_get')),
  updateRenamePatterns: (patterns: RenamePattern[]) =>
    _invoke<{ patterns: RenamePattern[] }>('rename_patterns_update', { patterns }).then((v) => {
      invalidateApiCache('rename_patterns_get');
      return v;
    }),
  resetRenamePatterns: () =>
    _invoke<{ patterns: RenamePattern[] }>('rename_patterns_reset').then((v) => {
      invalidateApiCache('rename_patterns_get');
      return v;
    }),

  getTheme: () => cachedInvoke('theme_get', () => _invoke<ThemeConfig>('theme_get')),
  saveTheme: (theme: ThemeConfig) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(theme)) {
      if (typeof v === 'string') safe[k] = v;
    }
    return _invoke<ThemeConfig>('theme_save', safe).then((v) => {
      invalidateApiCache('theme_get');
      return v;
    });
  },
  getPresets: () => _invoke<{ presets: string[] }>('theme_presets'),
  applyPreset: (name: string) =>
    _invoke<ThemeConfig>('theme_preset', { name }).then((v) => {
      invalidateApiCache('theme_get');
      return v;
    }),
  resetTheme: () =>
    _invoke<ThemeConfig>('theme_reset').then((v) => {
      invalidateApiCache('theme_get');
      return v;
    }),

  historyList: (body?: { limit?: number; offset?: number; run_type?: string; date_from?: string; date_to?: string }) => _invoke<{ runs: HistoryRunRow[] }>('history_list', body),
  historyGet: (id: number) => _invoke<{ run: HistoryRunRow }>('history_get', { id }),
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
  historyExport: (body?: { ids?: number[]; limit?: number; run_type?: string }) => _invoke<{ csv: string; count: number; filename: string }>('history_export', body),

  formatosList: () =>
    cachedInvoke('formatos_list', () => _invoke<{ formats: FormatInfo[] }>('formatos_list')),
  formatosGenerate: (body: { format_id: string; desde: number; hasta: number; output_path?: string }) =>
    _invoke<FormatosGenerateResponse>('formatos_generate', body),
  formatosUpload: (body: { nombre: string; filename: string; content_b64: string; persisted?: boolean; filename_pattern?: string }) =>
    _invoke<{ format: FormatInfo }>('formatos_upload', body).then((v) => {
      invalidateApiCache('formatos_list');
      return v;
    }),
  formatosDelete: (format_id: string) =>
    _invoke<{ deleted: boolean }>('formatos_delete', { format_id }).then((v) => {
      invalidateApiCache('formatos_list');
      return v;
    }),
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
    _invoke<{ format: FormatInfo }>('formatos_update_mapping', { format_id, mapping }).then((v) => {
      invalidateApiCache('formatos_list');
      return v;
    }),

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

  imageOptimizerSaveFiles: (body: { files: Array<{ filename: string; content_b64: string }>; output_folder: string }) =>
    _invoke<ImageOptimizerSaveFilesResponse>('image_optimizer_save_files', body),

  templatesList: () =>
    cachedInvoke('templates_list', () =>
      _invoke<{ templates: Array<{ id: string; name: string; filename: string; source?: string }> }>('templates_list'),
    ),
  templateGet: (name: string) =>
    _invoke<{ name: string; content: string; source?: string }>('template_get', { name }),

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
  fileTokenCleanup: (token: string) =>
    _invoke<{ cleaned: boolean }>('file_token_cleanup', { token }),
  spreadsheetExportVolantesTemplate: (body?: { output_path?: string }) =>
    _invoke<{ content_b64: string; filename: string; path?: string }>('spreadsheet_export_volantes_template', (body || {}) as unknown as Record<string, unknown>),

  htmlToPdf: (body: HtmlToPdfBody) =>
    _invoke<HtmlToPdfResponse>('html_to_pdf', body),

  technicalReportsList: (body?: TechnicalReportsListBody) =>
    _invoke<{ reports: TechnicalReportListItem[] | TechnicalReport[] }>('technical_reports_list', body),
  technicalReportsGet: (id: string) =>
    _invoke<{ report: TechnicalReport }>('technical_reports_get', { id }),
  technicalReportsCreate: (report?: Partial<TechnicalReport>) =>
    _invoke<{ success: boolean; report: TechnicalReport }>('technical_reports_create', report ? { report } : {}),
  technicalReportsUpdate: (id: string, report: Partial<TechnicalReport>) =>
    _invoke<{ success: boolean; report: TechnicalReport }>('technical_reports_update', { id, report }),
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

  informesV2List: (body?: InformesV2ListBody) =>
    _invoke<{ reports: InformeV2ListItem[] | InformeV2[] }>('informes_v2_list', body),
  informesV2Get: (id: string) =>
    _invoke<{ report: InformeV2 }>('informes_v2_get', { id }),
  informesV2Create: (report?: Partial<InformeV2>) =>
    _invoke<{ success: boolean; report: InformeV2 }>('informes_v2_create', report ? { report } : {}),
  informesV2Update: (id: string, report: Partial<InformeV2>) =>
    _invoke<{ success: boolean; report: InformeV2 }>('informes_v2_update', { id, report }),
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

  fichasTecnicasList: (body?: FichasTecnicasListBody) =>
    _invoke<{ fichas: FichaTecnicaListItem[] | FichaTecnica[]; total: number }>('fichas_tecnicas_list', body),
  fichasTecnicasGet: (id: string) =>
    _invoke<{ ficha: FichaTecnica }>('fichas_tecnicas_get', { id }),
  fichasTecnicasCreate: (ficha?: Partial<FichaTecnica>) =>
    _invoke<{ success: boolean; ficha: FichaTecnica }>('fichas_tecnicas_create', ficha ? { ficha } : {}),
  fichasTecnicasUpdate: (id: string, ficha: Partial<FichaTecnica>) =>
    _invoke<{ success: boolean; ficha: FichaTecnica }>('fichas_tecnicas_update', { id, ficha }),
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
    panels: Array<Record<string, unknown>> | PanelVM[];
    logos: { left_b64?: string; right_b64?: string };
    images: Record<string, string>;
    image_paths?: Record<string, string>;
    format?: string;
    template_id?: string;
    output_path?: string;
    export_mode?: string;
  }) => _invoke<{ pdf_base64: string; content_base64?: string; saved_path?: string; filename: string; format?: string; mime_type?: string }>('panel_aviso_corte_render_pdf', body),
  panelAvisoCorteTemplate: (body: { output_path: string; overwrite?: boolean }) => _invoke<{ path: string }>('panel_aviso_corte_template', body),

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

  previewUbicacion: (body: PreviewUbicacionParams) => _invoke<PreviewUbicacionResponse>('preview_ubicacion', body),
  generarUbicaciones: (body: GenerarUbicacionesParams) => _invoke<GenerarUbicacionesResponse>('generar_ubicaciones', body),
  ubicacionesKeysGet: () =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_get'),
  ubicacionesKeysSet: (keys: Record<string, string>) =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_set', { keys }),

  ...createAutoimgApi(_invoke),

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
