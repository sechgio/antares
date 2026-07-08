interface AutoImgSidebarHeaderProps {
  connected?: boolean;
  sheetName?: string;
}

export default function AutoImgSidebarHeader({
  connected = false,
  sheetName,
}: AutoImgSidebarHeaderProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2.5">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        aria-hidden
      >
        <span className="font-mono text-[9px] font-semibold tracking-tight text-[var(--accent-primary-hover)]">
          AI
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
            AutoIMG
          </h1>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              connected
                ? 'bg-[var(--accent-green)] shadow-[0_0_6px_var(--accent-green)]'
                : 'bg-[var(--text-muted)]'
            }`}
            title={connected ? 'Conectado' : 'Desconectado'}
            aria-label={connected ? 'Conectado' : 'Desconectado'}
          />
        </div>
        {sheetName && (
          <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]" title={sheetName}>
            {sheetName}
          </p>
        )}
      </div>
    </div>
  );
}
