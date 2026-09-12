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
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-500/25 bg-sky-500/[0.08] text-sky-400 select-none transition-all duration-150 hover:bg-sky-500/15"
          aria-label="Sincronizando cambios en la nube"
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
        </div>
      </WithHoverTooltip>
    );
  }

  if (isError) {
    return (
      <WithHoverTooltip label="Error al sincronizar con la nube — reintentando" placement="bottom" variant="dark">
        <div
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/[0.08] text-amber-400 select-none transition-all duration-150 hover:bg-amber-500/15"
          aria-label="Error al sincronizar con la nube — reintentando"
        >
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="absolute top-0.5 right-0.5 flex h-1.5 w-1.5">
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400 animate-pulse" />
          </span>
        </div>
      </WithHoverTooltip>
    );
  }

  return (
    <WithHoverTooltip label="Sincronizado con la nube" placement="bottom" variant="dark">
      <div
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400/90 select-none transition-all duration-150 hover:bg-emerald-500/10 hover:text-emerald-400"
        aria-label="Sincronizado con la nube"
      >
        <CloudCheck className="h-3.5 w-3.5 shrink-0" />
      </div>
    </WithHoverTooltip>
  );
});

