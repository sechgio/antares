import Button from '../ui/Button';

interface StickyActionBarProps {
  destino: string;
  onSelectDest: () => void;
  onStart: () => void;
  onCancel: () => void;
  running: boolean;
  allReady: boolean;
  summary: string;
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export default function StickyActionBar({
  destino, onSelectDest, onStart, onCancel, running, allReady, summary,
}: StickyActionBarProps) {
  const destinoLabel = destino
    ? destino.split(/[\\/]/).pop() || destino
    : 'Seleccionar carpeta de destino…';

  return (
    <div className="sticky bottom-0 left-0 right-0 z-30 bg-[var(--bg-base)]/80 backdrop-blur-xl border-t border-[var(--border-subtle)]">
      <div className="w-full px-5 py-4 flex items-center gap-4">
        {/* Destination Selector */}
        <button
          onClick={onSelectDest}
          className="flex-1 flex items-center gap-3 min-w-0 text-left px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-all group"
        >
          <div className="w-9 h-9 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors shrink-0">
            <FolderIcon className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="text-[11px] text-[var(--text-muted)] font-medium">Destino</span>
            <span className={`text-[13px] truncate ${destino ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'}`}>
              {destinoLabel}
            </span>
          </div>
        </button>

        {/* Action + Summary */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {!running ? (
            <Button variant="primary" size="md" onClick={onStart} disabled={!allReady} className="px-6">
              <PlayIcon className="w-4 h-4" />
              Iniciar conversión
            </Button>
          ) : (
            <Button variant="danger" size="md" onClick={onCancel} className="px-6">
              <StopIcon className="w-4 h-4" />
              Detener
            </Button>
          )}
          {summary && (
            <span className="text-[11px] text-[var(--text-muted)] max-w-[280px] truncate text-right">
              {summary}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
