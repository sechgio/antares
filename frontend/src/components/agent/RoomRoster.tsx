import type { AgentRoom } from '../../api/agentApi';

export default function RoomRoster({ rooms }: { rooms: AgentRoom[] }) {
  if (rooms.length === 0) return null;
  return (
    <section
      aria-label="Salas de agentes"
      className="mb-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
        <span>Salas</span>
        <span className="tabular-nums text-[var(--text-muted)]">{rooms.length}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {rooms.map((room) => (
          <li key={room.room_id}>
            <details className="text-[11px]">
              <summary className="flex min-w-0 cursor-pointer list-none items-baseline gap-2">
                <span className="truncate font-medium text-[var(--text-primary)]">Sala «{room.topic}»</span>
                <span
                  className="shrink-0 rounded-full border border-[var(--border-subtle)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]"
                >
                  {room.status === 'open' ? `Ronda ${room.round}/${room.rounds}` : 'Cerrada'}
                </span>
                <span className="min-w-0 truncate text-[10.5px] text-[var(--text-muted)]">
                  {room.status === 'open' && room.turn ? `turno de ${room.turn.agent}` : room.close_reason || ''}
                </span>
              </summary>
              <div className="mt-1 space-y-1 pl-2">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  {room.members.map((member) => (
                    <span
                      key={member.session_id}
                      className="rounded-full border border-[var(--border-subtle)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]"
                    >
                      {member.agent}
                      {member.awaiting_user ? ' · espera al usuario' : ''}
                    </span>
                  ))}
                </div>
                {room.transcript && (
                  <pre
                    className="max-h-44 overflow-auto whitespace-pre-wrap font-sans text-[10.5px] leading-relaxed text-[var(--text-muted)]"
                  >
                    {room.transcript}
                  </pre>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
