import { _invoke } from './core';
import type { AgentDelegation, AgentRole, AgentRoom } from './agentDelegation';
import type { CanvasDocument } from '../components/canvas/types';

export type { AgentDelegation, AgentRole, AgentRoom, AgentRoomMember } from './agentDelegation';

export type CanvasLayersResult = Required<Pick<CanvasDocument, 'id' | 'updatedAt' | 'layers' | 'fields'>> & {
  createdLayers: { id: string; name: string }[];
};

export type AgentPermissionMode = 'ask' | 'auto' | 'full';
export type AgentChannel = 'terminal' | 'files' | 'desktop' | 'cloud' | 'mcp' | 'documents' | 'memory' | 'agenda' | 'other';
export type AgentChannelRule = 'ask' | 'allow' | 'deny';
export type AgentApprovalRules = Partial<Record<AgentChannel, AgentChannelRule>>;
export type AgentApprovalSource = 'manual' | 'rule' | 'full' | 'web' | 'cancel';

export interface AgentUndo {
  available: boolean;
  kind?: 'restore' | 'delete';
  reason?: string;
  undone_at?: number | null;
}

export interface AgentRuleAudit {
  id: string;
  at: number;
  scope: 'session' | 'global';
  session_id?: string;
  channel: AgentChannel;
  from: AgentChannelRule | null;
  to: AgentChannelRule | null;
}

export type AgentReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  last_error: string | null;
  permission_mode?: AgentPermissionMode;
  approval_rules?: AgentApprovalRules;
  reasoning_effort?: AgentReasoningEffort;
  reasoning_levels?: AgentReasoningEffort[];
  profile?: { id: string; name: string };
}

export type AgentMemoryScope = 'shared-read' | 'own' | 'none';

export interface AgentProfile {
  id: string;
  name: string;
  color?: string;
  description: string;
  role?: AgentRole;
  instructions: string;
  starter: string;
  tools: string[] | null;
  tools_deny?: string[];
  memory_scope?: AgentMemoryScope;
  daily_tokens?: number;
  model?: { provider: string; model: string } | null;
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
  output?: string;
  started_at?: number;
  dispatch_id?: string | null;
  channel?: AgentChannel | null;
  approval_source?: AgentApprovalSource | null;
  recovered?: boolean;
  undo?: AgentUndo | null;
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
  notice?: boolean;
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
  cost?: number;
  turn?: AgentUsageTurn;
  window?: number;
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

export type AgentFilePreviewTarget = { kind: 'attachment'; id: string; name: string } | { kind: 'resource'; resource: string };
export type AgentDocumentBlock = { kind: 'paragraph'; text: string; style: string } | { kind: 'table'; rows: string[][] };
export type AgentFilePreview = { name: string; size: number } & (
  | { kind: 'pdf'; png_base64: string; pages: number; page: number }
  | { kind: 'image'; png_base64: string; width: number; height: number }
  | { kind: 'spreadsheet'; sheets: string[]; sheet: number; page: number; pages: number; total_rows: number;
      total_columns: number; rows: string[][]; row_start: number; truncated: boolean }
  | { kind: 'document'; blocks: AgentDocumentBlock[]; truncated: boolean }
  | { kind: 'text'; text: string; truncated: boolean }
);

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
  channel?: AgentChannel | null;
  source?: AgentApprovalSource | null;
  consumed_by?: string;
  context?: { account?: string; tool?: string; sheet_id?: string; scopes?: string[]; filename?: string;
    page_url?: string; page_time_origin?: number; domain?: string; policy_blocked?: boolean;
    computer?: { app?: string; window?: string; element?: string }; subagent?: string; subagent_role?: AgentRole };
  resources?: { path: string; sha256?: string }[];
  dispatch?: { status: string; finished_at?: number };
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

export interface AgentDocumentArtifact {
  kind?: 'document';
  id: string;
  family: string;
  template_id: string;
  template_revision: string;
  module?: string;
  sources?: { ids?: string[]; kind: string }[];
  reviewed?: Record<string, string>;
  receipt?: {
    channel?: AgentChannel | null;
    approval_source?: AgentApprovalSource | null;
    status?: string | null;
  };
  files: { name: string; sha256: string; pages: number; mime: string; size: number }[];
}

export interface AgentImageArtifact extends Omit<AgentDocumentArtifact, 'kind' | 'files' | 'template_id' | 'template_revision'> {
  kind: 'image'; family: 'image';
  files: (Omit<AgentDocumentArtifact['files'][number], 'pages'> & { title: string; width: number; height: number })[];
}
export interface AgentPageArtifact extends Omit<AgentDocumentArtifact, 'kind' | 'files'> {
  kind: 'page';
  title: string;
  files: { name: string; sha256: string; mime: string; size: number }[];
}

export type AgentArtifact = AgentDocumentArtifact | AgentPageArtifact | AgentImageArtifact;

export interface AgentQuestion {
  id: string;
  session_id: string;
  questions: { id: string; prompt: string; options?: string[] }[];
}

export interface AgentPanel {
  id: string;
  session_id: string;
  call_id: string;
  type: string;
  props: Record<string, unknown>;
  status: 'open' | 'answered';
  response: AgentPanelResponse | null;
  created_at: number;
}
export type AgentPanelResponse = { choice: string } | { values: Record<string, string | number | boolean> };

export interface AgentBrowserTab {
  id: string;
  label: string;
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  can_go_back: boolean;
  can_go_forward: boolean;
  user_control: boolean;
  busy_until?: number;
  busy_reason?: 'user_input' | 'control' | '';
  active: boolean;
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
  busy_until?: number;
  busy_reason?: 'user_input' | 'control' | '';
  active_tab?: string;
  tabs?: AgentBrowserTab[];
  reason?: 'page' | 'agent-open' | 'control' | 'closed' | 'busy';
}

export interface AgentBrowserElement {
  tag: string;
  id: string;
  classes: string[];
  selector: string;
  role: string;
  label: string;
  text: string;
  href: string;
  box: AgentBrowserBounds;
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
  workspace?: string | null;
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

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
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

  agentSessionRulesSet: (id: string, rules: AgentApprovalRules) =>
    _invoke<{ session: AgentSession; audit?: AgentRuleAudit[] }>('agent_session_rules_set', { id, rules }),

  agentPolicyGet: () =>
    _invoke<{ rules: AgentApprovalRules; audit: AgentRuleAudit[] }>('agent_policy_get'),

  agentPolicyRulesSet: (rules: AgentApprovalRules) =>
    _invoke<{ rules: AgentApprovalRules; audit: AgentRuleAudit[] }>('agent_policy_rules_set', { rules }),

  agentSessionReasoningSet: (id: string, reasoning_effort: AgentReasoningEffort) =>
    _invoke<{ session: AgentSession }>('agent_session_reasoning_set', { id, reasoning_effort }),

  agentSessionDelete: (id: string) =>
    _invoke<{ deleted: boolean; id: string }>('agent_session_delete', { id }),

  agentMessagesList: (session_id: string) =>
    _invoke<{
      messages: AgentMessage[];
      running: boolean;
      delegations?: AgentDelegation[];
      plan?: AgentPlan | null;
      resumable?: boolean;
      pending_approvals: AgentApproval[];
      artifacts?: AgentArtifact[];
      questions?: AgentQuestion[];
      panels?: AgentPanel[];
      context?: AgentContext;
      usage?: AgentUsage | null;
      context_window?: number;
      compaction_thresholds?: { warn: number; compact: number } | null;
      compacting?: boolean;
      token_budget?: { limit: number; used: number };
    }>('agent_messages_list', { session_id }),

  agentRoomsList: (session_id: string) => _invoke<{ rooms: AgentRoom[] }>('agent_rooms_list', { session_id }),

  agentContextRemoveFile: (session_id: string, path: string) =>
    _invoke<{ removed: number }>('agent_context_remove_file', { session_id, path }),

  agentWorkspaceSet: (session_id: string, path?: string) =>
    _invoke<{ workspace: string | null }>('agent_workspace_set', { session_id, ...(path ? { path } : {}) }),

  agentWorkspaceSelect: (session_id: string) =>
    _invoke<{ workspace: string | null }>('agent_workspace_set', { session_id, select: true }),

  agentMessageSend: (session_id: string, content: string, request_id: string, attachments: string[] = [], correction = false, skill_id?: string) =>
    _invoke<{ accepted: boolean; duplicate?: boolean; files?: AgentMessageFiles; mentions?: AgentMessageMentions }>(
      'agent_message_send',
      { session_id, content, request_id, ...(attachments.length ? { attachments } : {}), ...(correction ? { correction: true } : {}),
        ...(skill_id ? { skill_id } : {}) },
    ),

  agentAttach: (kind: 'files' | 'folder', dropped?: { paths?: string[]; data?: { name: string; data: string }[] }) =>
    _invoke<{ attachments: AgentAttachment[] }>('agent_attach', { kind, ...dropped }),

  agentFilePreview: (session_id: string, target: AgentFilePreviewTarget, page = 0, sheet = 0) =>
    _invoke<AgentFilePreview>('agent_file_preview', { session_id, page, sheet,
      ...(target.kind === 'attachment' ? { attachment_id: target.id } : { resource: target.resource }) }),

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

  agentBrowser: (action: 'state' | 'bounds' | 'tab' | 'new' | 'close' | 'control' | 'allow' | 'open' | 'back' | 'forward' | 'reload',
    extra: { url?: string; user?: boolean; tab?: string; bounds?: AgentBrowserBounds | null } = {}) =>
    _invoke<AgentBrowserState>('agent_browser', { action, ...extra }),
  agentBrowserCapture: () =>
    _invoke<{ png_base64: string; width: number; height: number; url: string; title: string }>('agent_browser', { action: 'capture' }),
  agentBrowserInspect: (x: number, y: number) =>
    _invoke<AgentBrowserElement | null>('agent_browser', { action: 'inspect', x, y }),
  agentTurnCancel: (session_id: string) =>
    _invoke<{ cancelled: boolean }>('agent_turn_cancel', { session_id }),

  agentApprove: (approval_id: string, options?: boolean | { remember?: boolean; grantApp?: boolean; channel?: AgentChannel; rule?: 'allow' | 'deny' }) =>
    _invoke<{ approval: AgentApproval }>('agent_approve', {
      approval_id,
      ...(typeof options === 'object' && options
        ? {
          ...(options.remember ? { remember: true } : {}),
          ...(options.grantApp ? { grant_app: true } : {}),
          ...(options.channel && options.rule ? { channel: options.channel, rule: options.rule } : {}),
        }
        : (options ? { remember: true } : {})),
    }),

  agentDeny: (approval_id: string, rule?: { channel: AgentChannel; rule: 'allow' | 'deny' }) =>
    _invoke<{ approval: AgentApproval }>('agent_deny', { approval_id, ...(rule ? { channel: rule.channel, rule: rule.rule } : {}) }),

  agentEffectUndo: (session_id: string, call_id: string) =>
    _invoke<{ undone: boolean; path: string; call_id: string }>('agent_effect_undo', { session_id, call_id }),

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

  agentArtifactAction: (params: { session_id: string; artifact_id: string; file_index: number; action: 'preview' | 'embed' | 'review' | 'open' | 'save' | 'print';
    color_scheme?: 'light' | 'dark';
    request_id?: string; sha256?: string; page?: number; full_size?: boolean; printer_name?: string; copies?: number; pages?: string; duplex?: string; quality?: string }) =>
    _invoke<{ png_base64?: string; html?: string; pages?: number; sha256?: string; reviewed?: boolean; approval?: AgentApproval; cancelled?: boolean; opened?: boolean; url?: string }>('agent_artifact_action', params),

  agentPrintersList: () => _invoke<{ printers: { name: string; default: boolean }[] }>('printers_list'),

  agentQuestionAnswer: (session_id: string, question_id: string, answers: Record<string, string>) =>
    _invoke<{ question: AgentQuestion }>('agent_question_answer', { session_id, question_id, answers }),
  agentPanelRespond: (session_id: string, panel_id: string, response: AgentPanelResponse) =>
    _invoke<{ panel: AgentPanel; message: string }>('agent_panel_respond', { session_id, panel_id, response }),

  agentProfilesList: () => _invoke<{ profiles: AgentProfile[] }>('agent_profiles_list'),

  agentProfileSave: (p: { id?: string; name: string; color?: string; description: string; role?: AgentRole; instructions: string; starter: string; tools: string[] | null; tools_deny?: string[]; memory_scope?: AgentMemoryScope; daily_tokens?: number | null; model?: { provider: string; model: string } | null }) =>
    _invoke<{ profile: AgentProfile }>('agent_profile_save', p),

  agentProfileDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_profile_delete', { id }),

  agentMemoryList: () => _invoke<{ items: AgentMemoryItem[] }>('agent_memory_list'),
  agentSkillsList: () =>
    _invoke<{ skills: AgentSkill[]; library: string; warnings: string[]; truncated: boolean }>('agent_skills_list'),

  agentMemoryUpdate: (params: { id: string; action: 'edit' | 'disable' | 'enable' | 'revert'; content?: string; when?: string; version?: number }) =>
    _invoke<{ item: AgentMemoryItem }>('agent_memory_update', params),

  agentMemoryDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_memory_delete', { id }),
};
