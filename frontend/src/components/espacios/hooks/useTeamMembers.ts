import { useEffect, useState } from 'react';
import { fetchTeamMembers } from '../api/espaciosApi';
import type { TeamMember } from '../types';

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchTeamMembers()
      .then((data) => {
        setMembers(data);
        setError(null);
      })
      .catch((err) => {
        setMembers([]);
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los miembros del equipo');
      });
  }, []);

  return { members, error };
}
