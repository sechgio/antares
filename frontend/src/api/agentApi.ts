import { _invoke } from './core';
import type { CanvasDocument } from '../components/canvas/types';

export type CanvasLayersResult = Required<Pick<CanvasDocument, 'id' | 'updatedAt' | 'layers' | 'fields'>> & {
  createdLayers: { id: string; name: string }[];
};

export type AgentPermissionMode = 'ask' | 'auto' | 'full';

export interface AgentSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  last_error: string | null;
  permission_mode?: AgentPermissionMode;
  profile?: { id: string; name: string };
}

export type AgentRole = 'explorer' | 'reviewer' | 'worker';

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  role?: AgentRole;
  instructions: string;
  starter: string;
  tools: string[] | null;
  created_at: number;
  updated_at: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
  gated: boolean;
  status: 'queued' | 'pending' | 'running' | 'done' | 'denied' | 'failed' | 'interrupted' | 'submitted';
  result?: string | null;
  /** Salida que la herramienta lleva producida mientras corre (p. ej. shell_run). */
  output?: string;
  /** Epoch ms en que empezó a ejecutarse, mientras sigue en curso. */
  started_at?: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  reasoning?: string;
  reasoning_ms?: number;
  tool_calls?: AgentToolCall[];
  tool_use_id?: string;
  name?: string;
  ts: number;
  partial?: boolean;
}

export interface AgentUsageTurn {
  input: number;
  output: number;
  cached?: number;
  cost?: number;
}

export interface AgentUsage {
  input: number;
  output: number;
  context?: number;
  cached?: number;
  prompt?: number;
  /** Gasto acumulado de la conversación en dólares, según pi.usage. */
  cost?: number;
  /** Última respuesta del proveedor. */
  turn?: AgentUsageTurn;
  /** Ventana real del modelo que respondió, si se conoce. */
  window?: number;
  /** Resúmenes de contexto aplicados hasta ahora. */
  compactions?: number;
}

interface AgentMessageFiles {
  granted: string[];
  rejected: { path: string; reason: string }[];
}

export interface AgentAttachment {
  id: string;
  name: string;
  kind: 'files' | 'folder';
}

interface AgentMessageMentions {
  modules: string[];
  unknown: string[];
  ambiguous: { mention: string; modules: string[] }[];
}

export interface AgentToolSpec {
  name: string;
  enabled?: boolean;
  gated: boolean;
  kind: 'backend' | 'mcp' | 'native' | 'subagent';
  module?: string | null;
}

export type AgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type AgentApprovalFilterStatus = AgentApprovalStatus | 'all' | 'uncertain';

export interface AgentApproval {
  id: string;
  session_id: string;
  call_id: string;
  method: string;
  params: Record<string, unknown>;
  fingerprint?: string;
  status: AgentApprovalStatus;
  created_at: number;
  decided_at: number | null;
  consumed_by?: string;
  context?: { account?: string; sheet_id?: string; scopes?: string[]; filename?: string; subagent?: string; subagent_role?: AgentRole };
  resources?: { path: string; sha256?: string }[];
  dispatch?: { status: string; finished_at?: number };
}

export interface AgentGrant {
  path: string;
  mode?: string;
  request_id?: string;
  size?: number;
  mtime_ns?: number;
}

export type AgentTaskStatus = 'pending' | 'delivering' | 'delivered' | 'cancelled' | 'uncertain';
export type AgentTaskKind = 'schedule' | 'queue';
export type AgentQueuePauseReason = 'manual' | 'continuation' | 'failed' | 'cancelled';

export interface AgentQueueState {
  session_id: string;
  paused: boolean;
  paused_reason?: AgentQueuePauseReason;
  pending: number;
  running: number;
}

export interface AgentTaskRun {
  at: number;
  due_at: number;
  status: 'delivered' | 'failed' | 'uncertain';
  silent?: boolean;
  error?: string;
}

export interface AgentTask {
  id: string;
  session_id: string;
  kind?: AgentTaskKind;
  seq?: number;
  content: string;
  due_at: number;
  interval_ms: number;
  status: AgentTaskStatus;
  created_at: number;
  updated_at?: number;
  timezone?: string;
  silent?: boolean;
  origin_task_id?: string;
  runs?: AgentTaskRun[];
  last_run_at?: number;
  last_status?: AgentTaskRun['status'];
  last_error?: string;
  retry_at?: number;
}

export interface AgentArtifact {
  id: string;
  family: string;
  template_id: string;
  template_revision: string;
  module?: string;
  sources?: { ids?: string[]; kind: string }[];
  reviewed?: Record<string, string>;
  files: { name: string; sha256: string; pages: number; mime: string; size: number }[];
}

export interface AgentQuestion {
  id: string;
  session_id: string;
  questions: { id: string; prompt: string; options?: string[] }[];
}

export interface AgentBrowserState {
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  can_go_back: boolean;
  can_go_forward: boolean;
  docked: boolean;
  user_control: boolean;
  reason?: 'page' | 'agent-open' | 'control' | 'closed';
}

export interface AgentBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentPlan {
  goal: string;
  steps: { title: string; status: 'pending' | 'in_progress' | 'done' | 'failed'; evidence?: string }[];
}

export interface AgentContext {
  modules: { id: string; label: string }[];
  files: { path: string; folder: boolean }[];
  accounts: string[];
}

export interface AgentMemoryItem {
  id: string;
  kind: 'preference' | 'fact' | 'procedure';
  title: string;
  status: 'active' | 'disabled' | 'suspended';
  reason: string | null;
  version: number;
  updated_at: number;
  content?: string;
  when?: string;
  steps?: { tool: string; purpose: string }[];
  source: { kind: 'user' | 'agent'; session_id?: string; op_ids?: string[]; artifact_ids?: string[]; reverted_to?: number };
  versions: { version: number; created_at: number; source: AgentMemoryItem['source'] }[];
}

export const agentApi = {
  agentSessionsList: () => _invoke<{ sessions: AgentSession[] }>('agent_sessions_list'),

  agentSessionCreate: (p: { provider: string; model?: string; title?: string; profile_id?: string }) =>
    _invoke<{ session: AgentSession }>('agent_session_create', p),

  agentSessionRename: (id: string, title: string) =>
    _invoke<{ session: AgentSession }>('agent_session_rename', { id, title }),

  agentSessionModelSet: (id: string, provider: string, model: string) =>
    _invoke<{ session: AgentSession }>('agent_session_model_set', { id, provider, model }),

  agentSessionPermissionsSet: (id: string, permission_mode: AgentPermissionMode) =>
    _invoke<{ session: AgentSession }>('agent_session_permissions_set', { id, permission_mode }),

  agentSessionDelete: (id: string) =>
    _invoke<{ deleted: boolean; id: string }>('agent_session_delete', { id }),

  agentMessagesList: (session_id: string) =>
    _invoke<{
      messages: AgentMessage[];
      running: boolean;
      plan?: AgentPlan | null;
      resumable?: boolean;
      pending_approvals: AgentApproval[];
      artifacts?: AgentArtifact[];
      questions?: AgentQuestion[];
      context?: AgentContext;
      usage?: AgentUsage | null;
      context_window?: number;
      compaction_thresholds?: { warn: number; compact: number } | null;
      compacting?: boolean;
    }>('agent_messages_list', { session_id }),

  agentContextRemoveFile: (session_id: string, path: string) =>
    _invoke<{ removed: number }>('agent_context_remove_file', { session_id, path }),

  agentMessageSend: (session_id: string, content: string, request_id: string, attachments: string[] = [], correction = false) =>
    _invoke<{ accepted: boolean; duplicate?: boolean; files?: AgentMessageFiles; mentions?: AgentMessageMentions }>(
      'agent_message_send',
      { session_id, content, request_id, ...(attachments.length ? { attachments } : {}), ...(correction ? { correction: true } : {}) },
    ),

  agentAttach: (kind: 'files' | 'folder') =>
    _invoke<{ attachments: AgentAttachment[] }>('agent_attach', { kind }),

  agentToolsList: (session_id?: string) => _invoke<{ tools: AgentToolSpec[] }>('agent_tools_list', session_id ? { session_id } : {}),

  agentToolsSet: (session_id: string, names: string[] | null) =>
    _invoke<{ tools: AgentToolSpec[] }>('agent_tools_set', { session_id, names }),

  agentTurnStatus: (session_id: string) =>
    _invoke<{
      running: boolean;
      pending_approvals: AgentApproval[];
      last_error: string | null;
      compacting?: boolean;
    }>('agent_turn_status', { session_id }),

  agentBrowser: (action: 'state' | 'bounds' | 'control' | 'open' | 'back' | 'forward' | 'reload',
    extra: { url?: string; user?: boolean; bounds?: AgentBrowserBounds | null } = {}) =>
    _invoke<AgentBrowserState>('agent_browser', { action, ...extra }),
  agentTurnCancel: (session_id: string) =>
    _invoke<{ cancelled: boolean }>('agent_turn_cancel', { session_id }),

  agentApprove: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_approve', { approval_id }),

  agentDeny: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_deny', { approval_id }),

  agentApprovalsHistory: (params: { session_id?: string; method?: string; status?: AgentApprovalFilterStatus; limit?: number } = {}) =>
    _invoke<{ approvals: AgentApproval[] }>('agent_approvals_history', params),

  agentGrantsList: (session_id: string) =>
    _invoke<{ grants: AgentGrant[] }>('agent_grants_list', { session_id }),

  agentGrantsRevoke: (session_id: string, path?: string) =>
    _invoke<{ revoked: number }>('agent_grants_revoke', { session_id, ...(path ? { path } : {}) }),

  agentTasksList: (session_id?: string) =>
    _invoke<{ tasks: AgentTask[]; queues: AgentQueueState[] }>('agent_tasks_list', session_id ? { session_id } : {}),

  agentTasksSave: (p: {
    session_id: string; id?: string; kind?: AgentTaskKind; content: string; due_at?: string;
    every_minutes?: number | null; silent?: boolean; timezone?: string;
  }) => _invoke<{ scheduled: AgentTask }>('agent_tasks_save', p),

  agentTasksCancel: (id: string) =>
    _invoke<{ cancelled: boolean; id: string }>('agent_tasks_cancel', { id }),

  agentTasksRun: (id: string) =>
    _invoke<{ scheduled: AgentTask }>('agent_tasks_run', { id }),

  agentTasksQueue: (session_id: string, action: 'pause' | 'resume') =>
    _invoke<{ queue: AgentQueueState }>('agent_tasks_queue', { session_id, action }),

  agentRendererResult: (id: string, result?: unknown, error?: string, uncertain = false) =>
    _invoke<{ accepted: boolean }>('agent_renderer_result', { id, result, error, ...(uncertain ? { uncertain: true } : {}) }),

  agentCanvasFill: (params: Record<string, unknown>) =>
    _invoke<Record<string, unknown>>('agent_canvas_fill', params),
  agentCanvasApplyLayers: (params: Record<string, unknown>) =>
    _invoke<CanvasLayersResult>('agent_canvas_apply_layers', params),

  agentArtifactAction: (params: { session_id: string; artifact_id: string; file_index: number; action: 'preview' | 'review' | 'open' | 'save' | 'print';
    request_id?: string; sha256?: string; page?: number; printer_name?: string; copies?: number; pages?: string; duplex?: string; quality?: string }) =>
    _invoke<{ png_base64?: string; pages?: number; sha256?: string; reviewed?: boolean; approval?: AgentApproval; cancelled?: boolean }>('agent_artifact_action', params),

  agentPrintersList: () => _invoke<{ printers: { name: string; default: boolean }[] }>('printers_list'),

  agentQuestionAnswer: (session_id: string, question_id: string, answers: Record<string, string>) =>
    _invoke<{ question: AgentQuestion }>('agent_question_answer', { session_id, question_id, answers }),

  agentProfilesList: () => _invoke<{ profiles: AgentProfile[] }>('agent_profiles_list'),

  agentProfileSave: (p: { id?: string; name: string; description: string; role?: AgentRole; instructions: string; starter: string; tools: string[] | null }) =>
    _invoke<{ profile: AgentProfile }>('agent_profile_save', p),

  agentProfileDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_profile_delete', { id }),

  agentMemoryList: () => _invoke<{ items: AgentMemoryItem[] }>('agent_memory_list'),

  agentMemoryUpdate: (params: { id: string; action: 'edit' | 'disable' | 'enable' | 'revert'; content?: string; when?: string; version?: number }) =>
    _invoke<{ item: AgentMemoryItem }>('agent_memory_update', params),

  agentMemoryDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_memory_delete', { id }),
};
