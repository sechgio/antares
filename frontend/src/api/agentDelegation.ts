export type AgentRole = 'explorer' | 'reviewer' | 'worker';

export interface AgentDelegation {
  session_id: string;
  agent: string;
  status: string;
  state: string;
  running: boolean;
  ms: number;
  task: string;
  done_when?: string;
  rounds?: number;
  max_rounds?: number;
  reason?: string;
  room_id?: string;
  last_tool?: { name: string; failed: boolean };
  parent_request_id?: string;
  root_parent_request_id?: string;
  parent_tool_call_id?: string;
}
