import { _invoke } from './core';

export interface AgentSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  last_error: string | null;
  /** Agente guardado del que nació la conversación. */
  profile?: { id: string; name: string };
}

// Agente guardado para una tarea repetitiva: mismo runtime, con sus
// indicaciones y herramientas. No se ejecuta solo ni amplía permisos.
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
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
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  tool_calls?: AgentToolCall[];
  tool_use_id?: string;
  name?: string;
  ts: number;
  partial?: boolean;
}

// Archivos cuya ruta escribió el usuario: concedidos (solo lectura) o rechazados.
export interface AgentMessageFiles {
  granted: string[];
  rejected: { path: string; reason: string }[];
}

// Adjunto elegido en el diálogo nativo: el renderer solo conoce su id y nombre.
export interface AgentAttachment {
  id: string;
  name: string;
  kind: 'files' | 'folder';
}

export interface AgentMessageMentions {
  modules: string[];
  unknown: string[];
  ambiguous: { mention: string; modules: string[] }[];
}

export interface AgentToolSpec {
  name: string;
  enabled?: boolean;
  gated: boolean;
  kind: 'backend' | 'mcp' | 'native';
  module?: string | null;
}

export interface AgentApproval {
  id: string;
  session_id: string;
  call_id: string;
  method: string;
  params: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  created_at: number;
  decided_at: number | null;
  context?: { account?: string; sheet_id?: string; scopes?: string[]; filename?: string };
  resources?: { path: string; sha256?: string }[];
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

// Contexto visible de la conversación: módulos mencionados, archivos
// concedidos y cuentas que firmaron aprobaciones.
export interface AgentContext {
  modules: { id: string; label: string }[];
  files: { path: string; folder: boolean }[];
  accounts: string[];
}

// Recuerdo del agente: la versión vigente y el historial con su fuente.
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

  agentSessionDelete: (id: string) =>
    _invoke<{ deleted: boolean; id: string }>('agent_session_delete', { id }),

  agentMessagesList: (session_id: string) =>
    _invoke<{
      messages: AgentMessage[];
      running: boolean;
      pending_approvals: AgentApproval[];
      artifacts?: AgentArtifact[];
      questions?: AgentQuestion[];
      context?: AgentContext;
      usage?: { input: number; output: number } | null;
    }>('agent_messages_list', { session_id }),

  agentContextRemoveFile: (session_id: string, path: string) =>
    _invoke<{ removed: number }>('agent_context_remove_file', { session_id, path }),

  // request_id identifica el envío: un reintento con el mismo id no crea otro encargo.
  // correction: redirige el encargo en curso tras la ronda de herramientas
  // actual; rechaza los pasos pendientes de aprobación, no los ya enviados.
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
    }>('agent_turn_status', { session_id }),

  agentTurnCancel: (session_id: string) =>
    _invoke<{ cancelled: boolean }>('agent_turn_cancel', { session_id }),

  agentApprove: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_approve', { approval_id }),

  agentDeny: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_deny', { approval_id }),

  agentRendererResult: (id: string, result?: unknown, error?: string, uncertain = false) =>
    _invoke<{ accepted: boolean }>('agent_renderer_result', { id, result, error, ...(uncertain ? { uncertain: true } : {}) }),

  agentCanvasFill: (params: Record<string, unknown>) =>
    _invoke<Record<string, unknown>>('agent_canvas_fill', params),

  agentArtifactAction: (params: { session_id: string; artifact_id: string; file_index: number; action: 'preview' | 'review' | 'open' | 'save' | 'print';
    request_id?: string; sha256?: string; page?: number; printer_name?: string; copies?: number; pages?: string; duplex?: string; quality?: string }) =>
    _invoke<{ png_base64?: string; pages?: number; sha256?: string; reviewed?: boolean; approval?: AgentApproval; cancelled?: boolean }>('agent_artifact_action', params),

  agentPrintersList: () => _invoke<{ printers: { name: string; default: boolean }[] }>('printers_list'),

  agentQuestionAnswer: (session_id: string, question_id: string, answers: Record<string, string>) =>
    _invoke<{ question: AgentQuestion }>('agent_question_answer', { session_id, question_id, answers }),

  agentProfilesList: () => _invoke<{ profiles: AgentProfile[] }>('agent_profiles_list'),

  agentProfileSave: (p: { id?: string; name: string; description: string; instructions: string; starter: string; tools: string[] | null }) =>
    _invoke<{ profile: AgentProfile }>('agent_profile_save', p),

  agentProfileDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_profile_delete', { id }),

  agentMemoryList: () => _invoke<{ items: AgentMemoryItem[] }>('agent_memory_list'),

  agentMemoryUpdate: (params: { id: string; action: 'edit' | 'disable' | 'enable' | 'revert'; content?: string; when?: string; version?: number }) =>
    _invoke<{ item: AgentMemoryItem }>('agent_memory_update', params),

  agentMemoryDelete: (id: string) => _invoke<{ deleted: boolean }>('agent_memory_delete', { id }),
};
