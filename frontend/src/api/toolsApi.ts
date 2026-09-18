import { _invoke, cachedInvoke } from './core';

export interface HtmlToPdfBody {
  html: string;
  filename: string;
  localImagePaths?: Record<string, string>;
  outputPath?: string;
  canvas_manifest_b64?: string;
  return_base64?: boolean;
}

export type HtmlToPdfResponse =
  | { pdf_base64: string; filename: string; saved_path?: never }
  | { pdf_base64?: never; filename: string; saved_path: string };

interface ImageOptimizerSaveFileEntry {
  filename: string;
  path: string;
}

interface ImageOptimizerSaveSkippedEntry {
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

export const toolsApi = {
  imageOptimizerSaveFiles: (body: {
    files: Array<{ filename: string; file_token?: string; content_b64?: string }>;
    output_folder: string;
  }) =>
    _invoke<ImageOptimizerSaveFilesResponse>('image_optimizer_save_files', body),

  templatesList: () =>
    cachedInvoke('templates_list', () =>
      _invoke<{ templates: Array<{ id: string; name: string; filename: string; source?: string }> }>('templates_list'),
    ),
  templateGet: (name: string) =>
    _invoke<{ name: string; content: string; source?: string }>('template_get', { name }),

  htmlToPdf: (body: HtmlToPdfBody) =>
    _invoke<HtmlToPdfResponse>('html_to_pdf', body),

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
