import type { CanvasDocument } from '../components/canvas/types';
import type { HistoryStep as CanvasHistoryStep } from '../components/canvas/utils/canvasDiff';
import { saveCanvasHistoryIncrementally } from './canvasHistoryTransport';
import { _invoke } from './core';
import type { HtmlToPdfResponse } from './toolsApi';

export interface CanvasExportCmykPdfBody {
  document: CanvasDocument;
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

export const canvasApi = {
  canvasList: () =>
    _invoke<{ documents: Array<{ id: string; name: string; updatedAt?: string }> }>('canvas_list'),
  canvasBootstrap: () =>
    _invoke<{
      documents: Array<{ id: string; name: string; updatedAt?: string }>;
      document: CanvasDocument | null;
    }>('canvas_bootstrap'),
  canvasGet: (id: string) => _invoke<{ document: CanvasDocument }>('canvas_get', { id }),
  canvasSave: (
    document: CanvasDocument,
    opts?: { touch?: boolean; slim?: boolean },
  ) =>
    _invoke<{
      document:
        | CanvasDocument
        | Pick<
            CanvasDocument,
            'id' | 'name' | 'updatedAt' | 'version' | 'page' | 'pages'
          >;
      slim?: boolean;
    }>('canvas_save', {
      document,
      ...(opts?.touch === false ? { touch: false } : {}),
      ...(opts?.slim ? { slim: true } : {}),
    }),
  canvasCreate: (name?: string) =>
    _invoke<{ document: CanvasDocument }>('canvas_create', name ? { name } : {}),
  canvasDelete: (id: string) => _invoke<{ success: boolean; deleted_id: string }>('canvas_delete', { id }),
  canvasDuplicate: (id: string, name?: string) =>
    _invoke<{ document: CanvasDocument }>('canvas_duplicate', name ? { id, name } : { id }),
  canvasExportCmykPdf: (body: CanvasExportCmykPdfBody) =>
    _invoke<HtmlToPdfResponse>('canvas_export_cmyk_pdf', body),
  canvasGetHistory: (id: string) =>
    _invoke<{ past: CanvasHistoryStep[]; future: CanvasHistoryStep[] }>('canvas_get_history', { id }),
  canvasSaveHistory: (id: string, past: CanvasHistoryStep[], future: CanvasHistoryStep[]) =>
    saveCanvasHistoryIncrementally(
      (params) => _invoke('canvas_save_history', params),
      id,
      past,
      future,
    ),
};
