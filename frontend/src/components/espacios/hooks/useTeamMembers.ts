import { useEffect, useState } from 'react';
import { fetchTeamMembers } from '../api/espaciosApi';
import type { TeamMember } from '../types';

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    void fetchTeamMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  return { members };
}