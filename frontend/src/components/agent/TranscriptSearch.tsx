import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { agentApi, type AgentTranscriptMatch } from '../../api/agentApi';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function TranscriptSearch({
  sessionId,
  onJump,
  onClose,
}: {
  sessionId: string;
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ matches: AgentTranscriptMatch[]; truncated: boolean } | null>(null);
  const [error, setError] = useState(false);
  const term = query.trim();

  useEffect(() => {
    setResult(null);
    setError(false);
    if (!term) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void agentApi.agentMessagesSearch(sessionId, term).then(
        (response) => {
          if (current) setResult(response);
        },
        () => {
          if (current) setError(true);
        },
      );
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [sessionId, term]);

  return (
    <section
      aria-label="Búsqueda en la conversación"
      className="mx-auto w-full max-w-[768px] px-4 pb-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Texto que buscas"
          autoFocus
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar mensajes…"
          className="min-w-0 flex-1"
        />
        <Button size="sm" variant="ghost" aria-label="Cerrar búsqueda en la conversación" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      {term && (
        <p role="status" className="mt-1 text-xs text-[var(--text-secondary)]">
          {error
            ? 'No se pudo buscar.'
            : !result
              ? 'Buscando…'
              : `${result.matches.length} resultados${result.truncated ? ' · búsqueda acotada' : ''}`}
        </p>
      )}
      {result && result.matches.length > 0 && (
        <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto">
          {result.matches.map((match) => (
            <li key={match.id}>
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start text-left"
                onClick={() => onJump(match.id)}
              >
                <span className="truncate">{match.text}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
