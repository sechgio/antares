import { _invoke, cachedInvoke } from './core';

export interface FileDialogResult {
  paths: string[];
  file_tokens: string[];
}

export const systemApi = {
  version: () => _invoke<{ version: string }>('version'),
  formats: () => cachedInvoke('formats', () => _invoke<{ formats: string[] }>('formats')),
  diagnosticsSnapshot: (params?: Record<string, unknown>) =>
    _invoke<Record<string, unknown>>('diagnostics_snapshot', params ?? {}),
  diagnosticsExport: (params?: { title?: string; defaultPath?: string }) =>
    _invoke<{ exported: boolean; canceled?: boolean; path?: string }>('diagnostics_export', params),
  logsOpenFolder: () => _invoke<{ opened: boolean; path: string }>('logs_open_folder'),

  dialogFiles: () => _invoke<FileDialogResult>('dialog_files'),
  dialogDest: () => _invoke<{ paths: string[] }>('dialog_dest'),
  dialogFolder: (params?: { title?: string; pickOnly?: boolean }) =>
    _invoke<FileDialogResult & { folder?: string }>('dialog_folder', params),
  dialogSave: (params?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => _invoke<{ paths: string[] }>('dialog_save', params),

  localThumbnail: (body: { path?: string; file_token?: string; maxEdge?: number }) =>
    _invoke<{ dataUrl: string }>('local_thumbnail', body),

  localImageDataUrl: (body: { path?: string; file_token?: string }) =>
    _invoke<{ dataUrl: string }>('local_image_data_url', body),
};
