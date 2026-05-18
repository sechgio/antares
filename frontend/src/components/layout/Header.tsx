interface HeaderProps {
  onSearchClick: () => void;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function Header({ onSearchClick }: HeaderProps) {
  return (
    <header
      data-testid="app-header"
      className="h-12 shrink-0 flex items-center justify-end px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 backdrop-blur-sm select-none"
    >
      <button
        onClick={onSearchClick}
        aria-label="Buscar"
        title="Buscar (Ctrl+K)"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-all"
      >
        <SearchIcon />
        <span>Buscar</span>
        <span className="text-[10px] bg-[var(--bg-input)] px-1.5 py-0.5 rounded border border-[var(--border-medium)]">Ctrl+K</span>
      </button>
    </header>
  );
}
