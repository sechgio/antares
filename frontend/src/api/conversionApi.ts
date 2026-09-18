import type { MappingCollision, PreviewItem, ProcessStatus } from '../types';
import { AntaresAPIError, _invoke } from './core';

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

export interface PreviewResult {
  preview: PreviewItem[];
  collisions?: MappingCollision[];
  detected_key_column?: string;
  detected_key_column_matches?: number;
  truncated?: boolean;
  total_files?: number;
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

export const conversionApi = {
  startProcess: (body: ProcessBody) =>
    _invoke<{ started: boolean; reason?: string; job_id?: string }>('process_start', body),

  getStatus: async () => parseProcessStatus(await _invoke<unknown>('process_status')),
  cancelProcess: () => _invoke<{ cancelled: boolean }>('process_cancel'),

  preview: (body: PreviewBody) => _invoke<PreviewResult>('preview', body),
  isVideo: (path: string) => _invoke<{ is_video: boolean }>('is_video', { path }),
};
