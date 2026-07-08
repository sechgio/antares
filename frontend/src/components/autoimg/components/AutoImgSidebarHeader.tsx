interface AutoImgSidebarHeaderProps {
  connected?: boolean;
  sheetName?: string;
  lastSync?: string;
}

export default function AutoImgSidebarHeader({
  connected = false,
  sheetName,
  lastSync,
}: AutoImgSidebarHeaderProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        aria-hidden
      >
        <span className="font-mono text-[10px] font-semibold tracking-tight text-[var(--accent-primary-hover)]">
          AI
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
            AutoIMG
          </h1>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              connected ? 'bg-[var(--accent-green)] shadow-[0_0_6px_var(--accent-green)]' : 'bg-[var(--accent-red)]'
            }`}
            title={connected ? 'Conectado' : 'Desconectado'}
            aria-label={connected ? 'Conectado' : 'Desconectado'}
          />
          <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            v4
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
          {connected
            ? sheetName || lastSync
              ? [sheetName, lastSync ? `sync ${lastSync}` : null].filter(Boolean).join(' · ')
              : 'Cuenta conectada'
            : 'Sin conexión a Google'}
        </p>
      </div>
    </div>
  );
}
