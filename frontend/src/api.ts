/**
 * API bridge: habla con el backend Python via Electron IPC (JSON-RPC)
 * en vez de HTTP fetch como en la arquitectura antigua (FastAPI+PyQt5).
 */

import type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy } from './types';

export type { ProcessStatus, LogEntry, PreviewItem, DBField, RenamePattern, DBRecord, ThemeConfig, VisualMapping, FormatInfo, FormatOrigin, MappingStrategy };

// ─── Electron IPC bridge ───────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      onNotify: (callback: (method: string, params: unknown) => void) => () => void;
      onUpdateAvailable?: (callback: (info: { version?: string }) => void) => () => void;
      onUpdateDownloaded?: (callback: (info: { version?: string }) => void) => () => void;
      quitAndInstall?: () => void;
      minimizeWindow?: () => Promise<unknown>;
      maximizeWindow?: () => Promise<unknown>;
      closeWindow?: () => Promise<unknown>;
      showAppMenu?: (menuIndex: number, position: { x: number; y: number }) => Promise<unknown>;
    };
  }
}

const _invoke = async <T>(method: string, params?: Record<string, unknown> | object): Promise<T> => {
  if (!window.electronAPI) {
    throw new Error('Electron IPC no disponible');
  }
  return window.electronAPI.invoke(method, params as Record<string, unknown>) as Promise<T>;
};

export function onNotify(callback: (method: string, params: unknown) => void) {
  if (!window.electronAPI) return () => {};
  return window.electronAPI.onNotify(callback);
}

// ─── API methods ───────────────────────────────────────────────────────────

export interface ProcessBody {
  files: string[];
  destino: string;
  formato: string;
  calidad: number;
  resize_ancho: number | null;
  resize_alto: number | null;
  keep_exif: boolean;
  usar_rename: boolean;
  patron: string;
  secuencia: number;
  use_filename_seq: boolean;
}

export interface PreviewBody {
  files: string[];
  patron: string;
  secuencia: number;
  use_filename_seq: boolean;
}

export interface PreviewImageBody {
  path: string;
  formato: string;
  calidad: number;
  resize?: number[] | null;
}

export const api = {
  version: () => _invoke<{ version: string }>('version'),
  formats: () => _invoke<{ formats: string[] }>('formats'),

  dialogFiles: () => _invoke<{ paths: string[] }>('dialog_files'),
  dialogFolder: () => _invoke<{ paths: string[] }>('dialog_folder'),
  dialogDest: () => _invoke<{ paths: string[] }>('dialog_dest'),
  dialogSave: () => _invoke<{ paths: string[] }>('dialog_save'),

  startProcess: (body: ProcessBody) => _invoke<{ started: boolean }>('process_start', body),
  getStatus: () => _invoke<ProcessStatus>('process_status'),
  cancelProcess: () => _invoke<{ cancelled: boolean }>('process_cancel'),

  preview: (body: PreviewBody) => _invoke<{ preview: PreviewItem[] }>('preview', body),
  previewImage: (body: PreviewImageBody) =>
    _invoke<{ preview: string; width: string; height: string; orig_size_kb: string }>('preview_image', body),

  isVideo: (path: string) => _invoke<{ is_video: boolean }>('is_video', { path }),

  getRecords: () => _invoke<{ records: DBRecord[]; fields: string[] }>('db_records'),
  importExcel: (path: string) => _invoke<{ imported: number }>('db_import', { path }),
  exportExcel: (path: string) => _invoke<{ exported: number }>('db_export', { path }),
  generateTemplate: (path: string) => _invoke<{ path: string }>('db_template', { path }),
  clearDatabase: () => _invoke<{ cleared: number }>('db_clear'),
  scanFolder: (folder: string) => _invoke<{ files: string[] }>('scan_folder', { folder }),

  getFields: () => _invoke<{ fields: DBField[] }>('db_fields'),
  updateFields: (fields: DBField[]) => _invoke<{ fields: DBField[] }>('db_fields_update', { fields }),
  resetFields: () => _invoke<{ fields: DBField[] }>('db_fields_reset'),

  getRenamePatterns: () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_get'),
  updateRenamePatterns: (patterns: RenamePattern[]) => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_update', { patterns }),
  resetRenamePatterns: () => _invoke<{ patterns: RenamePattern[] }>('rename_patterns_reset'),

  getTheme: () => _invoke<ThemeConfig>('theme_get'),
  saveTheme: (theme: ThemeConfig) => _invoke<ThemeConfig>('theme_save', theme as unknown as Record<string, unknown>),
  getPresets: () => _invoke<{ presets: string[] }>('theme_presets'),
  applyPreset: (name: string) => _invoke<ThemeConfig>('theme_preset', { name }),
  resetTheme: () => _invoke<ThemeConfig>('theme_reset'),

  historyList: (body?: { limit?: number; run_type?: string }) => _invoke<{ runs: unknown[] }>('history_list', body),
  historyGet: (id: number) => _invoke<{ run: unknown }>('history_get', { id }),
  historyDelete: (id: number) => _invoke<{ deleted: boolean }>('history_delete', { id }),
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
  }) => _invoke<{ id: number }>('history_save', body),

  // ─── Formatos PDF ───────────────────────────────────────────────────────
  formatosList: () => _invoke<{ formats: FormatInfo[] }>('formatos_list'),
  formatosGenerate: (body: { format_id: string; desde: number; hasta: number }) =>
    _invoke<{ pdf_base64: string; filename: string }>('formatos_generate', body),
  formatosUpload: (body: { nombre: string; filename: string; content_b64: string; persisted?: boolean; filename_pattern?: string }) =>
    _invoke<{ format: FormatInfo }>('formatos_upload', body),
  formatosDelete: (format_id: string) => _invoke<{ deleted: boolean }>('formatos_delete', { format_id }),
  formatosUpdateMapping: (format_id: string, mapping: VisualMapping) =>
    _invoke<{ format: FormatInfo }>('formatos_update_mapping', { format_id, mapping }),

  // ─── Image Optimizer ────────────────────────────────────────────────────
  imageOptimizerZip: (body: { files: Array<{ filename: string; content_b64: string }>; zip_name: string }) =>
    _invoke<{ zip_base64: string; filename: string }>('image_optimizer_zip', body),

  // ─── Plantillas PreviewPanel ─────────────────────────────────────────────
  templatesList: () => _invoke<{ templates: Array<{ id: string; name: string; filename: string }> }>('templates_list'),
  templateGet: (name: string) => _invoke<{ name: string; content: string }>('template_get', { name }),

  // ─── Render HTML to PDF via Electron ─────────────────────────────────────
  htmlToPdf: (body: { html: string; filename: string }) =>
    _invoke<{ pdf_base64: string; filename: string }>('html_to_pdf', body),
};
