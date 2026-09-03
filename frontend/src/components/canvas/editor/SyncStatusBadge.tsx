import { memo } from 'react';
import { CloudCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface SyncStatusBadgeProps {
  status: 'idle' | 'syncing' | 'synced' | 'error';
}

export default memo(function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  if (status === 'idle') return null;

  const isSyncing = status === 'syncing';
  const isError = status === 'error';

  if (isSyncing) {
    return (
      <WithHoverTooltip label="Sincronizando cambios en la nube" placement="bottom" variant="dark">
        <div
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400 select-none transition-all duration-200 hover:bg-sky-500/15"
          aria-label="Sincronizando cambios en la nube"
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
          <span className="absolute top-1 right-1 flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400" />
          </span>
        </div>
      </WithHoverTooltip>
    );
  }

  if (isError) {
    return (
      <WithHoverTooltip label="Error al sincronizar con la nube — reintentando" placement="bottom" variant="dark">
        <div
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 select-none transition-all duration-200 hover:bg-amber-500/15"
          aria-label="Error al sincronizar con la nube — reintentando"
        >
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="absolute top-1 right-1 flex h-1.5 w-1.5">
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400 animate-pulse" />
          </span>
        </div>
      </WithHoverTooltip>
    );
  }

  return (
    <WithHoverTooltip label="Sincronizado con la nube" placement="bottom" variant="dark">
      <div
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 select-none transition-all duration-200 hover:bg-emerald-500/15"
        aria-label="Sincronizado con la nube"
      >
        <CloudCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="absolute top-1 right-1 flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" style={{ animationDuration: '2.5s' }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        </span>
      </div>
    </WithHoverTooltip>
  );
});

