import type { TeamMember } from '../types';

export function memberName(members: TeamMember[], id: string | null): string | null {
  if (!id) return null;
  return members.find((m) => m.user_id === id)?.display_name ?? null;
}

export function memberLabel(members: TeamMember[], id: string | null): string {
  return memberName(members, id) ?? '—';
}