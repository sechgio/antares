import { CheckCircle2, XCircle } from 'lucide-react';

interface AutoImgSidebarHeaderProps {
  connected?: boolean;
}

export default function AutoImgSidebarHeader({ connected = false }: AutoImgSidebarHeaderProps) {
  return (
    <div className="border-b border-[var(--border-subtle)] px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">AutoIMG</h1>
          {connected ? (
            <CheckCircle2
              size={16}
              className="shrink-0 text-emerald-400"
              aria-label="Conectado"
            />
          ) : (
            <XCircle
              size={16}
              className="shrink-0 text-red-400"
              aria-label="Desconectado"
            />
          )}
        </div>
        <span className="text-[10px] font-medium tabular-nums text-[var(--text-muted)]">v4</span>
      </div>
    </div>
  );
}