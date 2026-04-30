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

export default function StickyActionBar({
  destino, onSelectDest, onStart, onCancel, running, allReady, summary,
}: StickyActionBarProps) {
  return (
    <div className="sticky bottom-0 left-0 right-0 z-30 bg-[#0A0A0A]/90 backdrop-blur-xl border-t border-[#222222]">
      <div className="w-full px-6 py-4 flex items-center justify-between gap-4">
        <button
          onClick={onSelectDest}
          className="flex-1 flex items-center gap-3 min-w-0 text-left px-4 py-2.5 rounded-xl bg-[#111111] border border-[#1A1A1A] hover:border-[#333333] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#666666] shrink-0">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[13px] truncate text-[#A0A0A0]">
            {destino || 'Seleccionar carpeta de destino…'}
          </span>
        </button>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!running ? (
            <Button variant="primary" size="md" onClick={onStart} disabled={!allReady}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Iniciar conversión
            </Button>
          ) : (
            <Button variant="danger" size="md" onClick={onCancel}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Detener
            </Button>
          )}
          <span className="text-[11px] text-[#666666]">{summary}</span>
        </div>
      </div>
    </div>
  );
}
