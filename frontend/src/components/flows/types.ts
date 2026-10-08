export type FlowNodeKind =
  | 'trigger'
  | 'tool_call'
  | 'condition'
  | 'transform'
  | 'loop'
  | 'http_request'
  | 'agent'
  | 'switch'
  | 'mcp_call'
  | 'code';

export type TriggerKind = 'manual' | 'schedule' | 'app_event' | 'webhook';

export interface FlowNodePosition {
  x: number;
  y: number;
}

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  name: string;
  config: Record<string, unknown>;
  position: FlowNodePosition;
}

export interface FlowEdge {
  from_node: string;
  to_node: string;
  from_port: string;
  to_port: string;
}

export interface WorkflowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: WorkflowGraph;
  created_at: string;
  updated_at: string;
  last_run_status: FlowRunStatus | null;
  last_run_at: string | null;
  last_scheduled_at?: string | null;
}

export type FlowMeta = Omit<Flow, 'graph'>;

export type FlowRunStatus = 'queued' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled' | 'skipped';

export interface PendingApproval {
  id: string;
  run_id: string;
  flow_id: string;
  flow_name: string;
  node_id: string;
  node_name: string;
  method: string;
  params: Record<string, unknown>;
  inside_loop?: boolean;
  created_at: string;
}

export interface PendingEffect {
  flow_id: string;
  flow_name: string;
  fingerprint: string;
  method: string;
  node_id: string;
  created_at: string;
}

export interface FlowRunStep {
  node_id: string;
  kind: string;
  name: string;
  status: 'running' | 'waiting' | 'success' | 'error' | 'skipped' | 'cancelled';
  iteration?: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  output: unknown;
  error: string | null;
  attempts?: number | null;
}

export interface FlowRunApproval {
  id: string;
  node_id?: string;
  node_name?: string;
  method?: string;
  params?: unknown;
  decision?: string | null;
}

export interface FlowRun {
  id: string;
  flow_id: string;
  flow_name: string;
  status: FlowRunStatus;
  graph?: WorkflowGraph;
  trigger_payload: Record<string, unknown>;
  steps: FlowRunStep[];
  error: string | null;
  interrupted?: boolean;
  checkpoint?: { approvals?: Record<string, FlowRunApproval> } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
