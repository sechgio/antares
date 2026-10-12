import type { EditorProject } from '../components/editor/types';
import { _invoke } from './core';

export interface EditorBootstrapResult {
  schemaVersion: number;
  projects: Array<{ id: string; name: string; updatedAt?: string; revision?: number }>;
  toolchain: {
    available: boolean;
    missingFilters?: string[] | null;
    missingEncoders?: string[] | null;
  };
}

export interface EditorJobStatus {
  jobId: string;
  type: string;
  stages: string[];
  state: string;
  progress: number;
  stage: string;
  imported: unknown[];
  failed: Array<{ token_suffix: string; reason: string }>;
  running: boolean;
  cancelled: boolean;
  ok_count?: number;
  err_count?: number;
}

export interface EditorImportResult {
  started: boolean;
  jobId?: string;
  reason?: string;
  running?: number;
  max_concurrent?: number;
}

export const editorApi = {
  editorBootstrap: () => _invoke<EditorBootstrapResult>('editor_bootstrap'),
  editorProjectCreate: (name?: string, requestId?: string) =>
    _invoke<{ project: EditorProject }>('editor_project_create', {
      ...(name ? { name } : {}),
      ...(requestId ? { requestId } : {}),
    }),
  editorProjectGet: (projectId: string) =>
    _invoke<{ project: EditorProject }>('editor_project_get', { projectId }),
  editorProjectSave: (
    document: EditorProject,
    expectedRevision: number,
    requestId?: string,
  ) =>
    _invoke<{ project: EditorProject }>('editor_project_save', {
      document,
      expectedRevision,
      ...(requestId ? { requestId } : {}),
    }),
  editorProjectDuplicate: (projectId: string, name?: string, requestId?: string) =>
    _invoke<{ project: EditorProject }>('editor_project_duplicate', {
      projectId,
      ...(name ? { name } : {}),
      ...(requestId ? { requestId } : {}),
    }),
  editorProjectDelete: (projectId: string) =>
    _invoke<{ deleted_id: string; trash: boolean }>('editor_project_delete', { projectId }),
  editorImportFiles: (title?: string) =>
    _invoke<{ paths: string[]; file_tokens: string[] }>('editor_import_files', {
      ...(title ? { title } : {}),
    }),
  editorRecordingCreate: (sessionId: string, mimeType?: string, quotaBytes?: number) =>
    _invoke<{ sessionId: string; maxInFlightBytes: number }>('editor_recording_create', {
      sessionId,
      ...(mimeType ? { mimeType } : {}),
      ...(quotaBytes ? { quotaBytes } : {}),
    }),
  editorRecordingAppend: (sessionId: string, seq: number, chunkB64: string) =>
    _invoke<{ sessionId: string; seq: number; writtenBytes: number }>(
      'editor_recording_append',
      { sessionId, seq, chunkB64 },
    ),
  editorRecordingFinish: (sessionId: string) =>
    _invoke<{ sessionId: string; path: string; writtenBytes: number; file_token: string }>(
      'editor_recording_finish',
      { sessionId },
    ),
  editorRecordingAbort: (sessionId: string) =>
    _invoke<{ sessionId: string; aborted: boolean }>('editor_recording_abort', { sessionId }),
  editorExportStart: (document: EditorProject, outputPath?: string, requestId?: string) =>
    _invoke<EditorImportResult>('editor_export_start', {
      document,
      ...(outputPath ? { outputPath } : {}),
      ...(requestId ? { requestId } : {}),
    }),
  editorEffectStart: (
    document: EditorProject,
    effectType: 'stabilize' | 'chromakey',
    clipId?: string,
    params?: Record<string, unknown>,
    requestId?: string,
  ) =>
    _invoke<EditorImportResult>('editor_effect_start', {
      document,
      effectType,
      ...(clipId ? { clipId } : {}),
      ...(params ? { params } : {}),
      ...(requestId ? { requestId } : {}),
    }),
  editorAssetsImportStart: (files: string[], requestId?: string) =>
    _invoke<EditorImportResult>('editor_assets_import_start', {
      files,
      ...(requestId ? { requestId } : {}),
    }),
  editorJobStatus: (jobId: string) =>
    _invoke<EditorJobStatus>('editor_job_status', { jobId }),
  editorJobCancel: (jobId: string) =>
    _invoke<{ cancelled: boolean; job_id?: string; reason?: string }>('editor_job_cancel', {
      jobId,
    }),
};
