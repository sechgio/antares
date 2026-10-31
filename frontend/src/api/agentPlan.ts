export const AGENT_PLAN_STATUSES = ['pending', 'in_progress', 'done', 'failed'] as const;

export type AgentPlanStatus = (typeof AGENT_PLAN_STATUSES)[number];
