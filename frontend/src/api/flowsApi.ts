import { _invoke } from './core';
import type { Flow, FlowMeta, FlowRun, WorkflowGraph } from '../components/flows/types';

export interface ReportBatchPreview {
  ready?: boolean;
  reason?: string;
  headers?: string[];
  suggested_mappings?: Record<string, string>;
  missing_mappings?: string[];
  pending?: string[];
  template_name?: string;
  image_limit?: number;
  required_fields?: string[];
  field_labels?: Record<string, string>;
  preview?: { row_index: number; ot: string; date: string; data: Record<string, string>; images: string[]; candidates: string[]; errors: string[] }[];
}

export const flowsApi = {
  flowsList: () => _invoke<{ flows: FlowMeta[] }>('flows_list'),
  flowsGet: (id: string) => _invoke<{ flow: Flow }>('flows_get', { id }),
  flowsCreate: (params: { name?: string; description?: string; graph?: WorkflowGraph }) =>
    _invoke<{ flow: Flow }>('flows_create', params),
  flowsUpdate: (params: {
    id: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    graph?: WorkflowGraph;
    expected_updated_at?: string;
  }) => _invoke<{ flow: Flow }>('flows_update', params),
  flowsDelete: (id: string) => _invoke<{ deleted: boolean; id: string }>('flows_delete', { id }),
  flowsDuplicate: (id: string, name?: string) =>
    _invoke<{ flow: Flow }>('flows_duplicate', name ? { id, name } : { id }),
  flowsRun: (id: string, triggerPayload?: Record<string, unknown>, acknowledgeUncertain?: boolean) =>
    _invoke<{ run: FlowRun }>('flows_run', {
      id,
      ...(triggerPayload ? { trigger_payload: triggerPayload } : {}),
      ...(acknowledgeUncertain ? { acknowledge_uncertain: true } : {}),
    }),
  flowsRunStatus: (runId: string) => _invoke<{ run: FlowRun }>('flows_run_status', { run_id: runId }),
  flowsRunsList: (params?: { flow_id?: string; limit?: number }) =>
    _invoke<{ runs: FlowRun[] }>('flows_runs_list', params ?? {}),
  flowsRunCancel: (runId: string) =>
    _invoke<{ run: FlowRun | null; cancelled: boolean }>('flows_run_cancel', { run_id: runId }),
  flowsOrchestratableMethods: () =>
    _invoke<{ methods: string[]; actions?: string[] }>('flows_orchestratable_methods'),
  flowsReadImages: (params: { source_folder: string; output_folder: string; expected_images?: number; images_per_panel?: number; spreadsheet_path?: string; report_template?: string; field_mappings?: Record<string, string>; photo_selections?: Record<string, string[]> }) =>
    _invoke<Record<string, unknown> & ReportBatchPreview>('flows_read_images', params),
  flowsRenderPdf: (params: { html?: string; template_name?: string; context?: Record<string, unknown>; contexts?: Record<string, unknown>[]; localImagePaths?: Record<string, string>; photo_digests?: Record<string, string>; expected_pages?: number; output_path: string }) =>
    _invoke<{ ready?: boolean; reason?: string; saved_path?: string; filename?: string }>('flows_render_pdf', params),
  flowsPrintersList: () => _invoke<{ printers: { name: string; default: boolean }[] }>('flows_printers_list'),
  flowsPrintPdf: (params: { pdf_path: string; printer_name: string; copies?: number }) =>
    _invoke<{ ready?: boolean; reason?: string; queued?: boolean; job_id?: number; printer_name?: string }>('flows_print_pdf', params),
};
