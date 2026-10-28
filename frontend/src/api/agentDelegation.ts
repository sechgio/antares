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
  delivery?: {
    state: string;
    attempts: number;
    retry_at?: number;
    delivered_at?: number;
    error?: string;
  };
  room_id?: string;
  room?: {
    id: string;
    topic: string;
    status: string;
    round: number;
    rounds: number;
    members: number;
    turn_member?: string;
    turn_agent?: string;
    turn_deadline?: number;
    closed_at?: number;
    close_reason?: string;
  };
  last_tool?: { name: string; failed: boolean };
  parent_request_id?: string;
  root_parent_request_id?: string;
  parent_tool_call_id?: string;
}

export interface AgentRoomMember {
  session_id: string;
  agent: string;
  status?: string;
  awaiting_user?: boolean;
}

export interface AgentRoom {
  room_id: string;
  topic: string;
  status: string;
  rounds: number;
  round: number;
  members: AgentRoomMember[];
  turn?: { member: string; agent: string; index: number; deadline: number };
  transcript: string;
  closed_at?: number;
  close_reason?: string;
}
