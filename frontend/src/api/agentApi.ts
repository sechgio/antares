import { _invoke } from './core';

export interface AgentSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  last_error: string | null;
}

export interface AgentToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
  gated: boolean;
  status: 'queued' | 'pending' | 'done' | 'denied';
  result?: string | null;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  tool_calls?: AgentToolCall[];
  tool_use_id?: string;
  name?: string;
  ts: number;
}

export interface AgentApproval {
  id: string;
  session_id: string;
  call_id: string;
  method: string;
  params: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  created_at: number;
  decided_at: number | null;
}

export const agentApi = {
  agentSessionsList: () => _invoke<{ sessions: AgentSession[] }>('agent_sessions_list'),

  agentSessionCreate: (p: { provider: string; model?: string; title?: string }) =>
    _invoke<{ session: AgentSession }>('agent_session_create', p),

  agentSessionDelete: (id: string) =>
    _invoke<{ deleted: boolean; id: string }>('agent_session_delete', { id }),

  agentMessagesList: (session_id: string) =>
    _invoke<{
      messages: AgentMessage[];
      running: boolean;
      pending_approvals: AgentApproval[];
    }>('agent_messages_list', { session_id }),

  agentMessageSend: (session_id: string, content: string) =>
    _invoke<{ accepted: boolean }>('agent_message_send', { session_id, content }),

  agentTurnStatus: (session_id: string) =>
    _invoke<{
      running: boolean;
      pending_approvals: AgentApproval[];
      last_error: string | null;
    }>('agent_turn_status', { session_id }),

  agentApprove: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_approve', { approval_id }),

  agentDeny: (approval_id: string) =>
    _invoke<{ approval: AgentApproval }>('agent_deny', { approval_id }),
};
