import { _invoke } from './core';
import type { Flow, FlowMeta, FlowRun, WorkflowGraph } from '../components/flows/types';

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
  flowsRun: (id: string, triggerPayload?: Record<string, unknown>) =>
    _invoke<{ run: FlowRun }>('flows_run', {
      id,
      ...(triggerPayload ? { trigger_payload: triggerPayload } : {}),
    }),
  flowsRunStatus: (runId: string) => _invoke<{ run: FlowRun }>('flows_run_status', { run_id: runId }),
  flowsRunsList: (params?: { flow_id?: string; limit?: number }) =>
    _invoke<{ runs: FlowRun[] }>('flows_runs_list', params ?? {}),
  flowsRunCancel: (runId: string) =>
    _invoke<{ run: FlowRun | null; cancelled: boolean }>('flows_run_cancel', { run_id: runId }),
  flowsOrchestratableMethods: () =>
    _invoke<{ methods: string[] }>('flows_orchestratable_methods'),
};
