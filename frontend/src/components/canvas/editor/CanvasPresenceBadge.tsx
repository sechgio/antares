import { memo } from 'react';
import { AlertCircle, Radio, Users, WifiOff, type LucideIcon } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasCollaborator, CanvasRealtimeStatus } from '../sync/canvasRealtime';

type CanvasPresenceBadgeProps = {
  collaborators: CanvasCollaborator[];
  status: CanvasRealtimeStatus;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${last?.[0] ?? ''}` : parts[0]?.slice(0, 2) ?? '?').toUpperCase();
}

const STATUS_PRESENTATION: Record<CanvasRealtimeStatus, {
  label: string;
  Icon: LucideIcon;
  iconClass: string;
  compactLabel: string;
}> = {
  idle: { label: 'Canvas sin conexión', Icon: WifiOff, iconClass: 'text-amber-400', compactLabel: 'Sin conexión' },
  live: { label: 'Canvas en vivo', Icon: Radio, iconClass: 'text-emerald-400', compactLabel: 'En vivo' },
  connecting: {
    label: 'Conectando colaboración en vivo',
    Icon: Radio,
    iconClass: 'text-emerald-400 animate-pulse',
    compactLabel: 'Sin conexión',
  },
  error: { label: 'Error de colaboración, reintentando', Icon: AlertCircle, iconClass: 'text-amber-400', compactLabel: 'Sin conexión' },
  offline: { label: 'Canvas sin conexión', Icon: WifiOff, iconClass: 'text-amber-400', compactLabel: 'Sin conexión' },
};

function labelFor(collaborators: CanvasCollaborator[], status: CanvasRealtimeStatus): string {
  if (collaborators.length > 0) {
    return `${collaborators.length} colaborador${collaborators.length === 1 ? '' : 'es'} conectado${collaborators.length === 1 ? '' : 's'}`;
  }
  return STATUS_PRESENTATION[status].label;
}

export default memo(function CanvasPresenceBadge({
  collaborators,
  status,
}: CanvasPresenceBadgeProps) {
  if (status === 'idle' || (status === 'offline' && collaborators.length === 0)) return null;

  const label = labelFor(collaborators, status);
  const names = collaborators.map((collaborator) => collaborator.displayName).join(', ');
  const { Icon, iconClass, compactLabel } = STATUS_PRESENTATION[status];

  return (
    <WithHoverTooltip label={names ? `${label}: ${names}` : label} placement="bottom" variant="dark">
      <div
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 text-emerald-400 select-none transition-all duration-200 hover:bg-emerald-500/15"
        aria-label={label}
        data-testid="canvas-presence-badge"
        data-status={status}
        role="status"
      >
        {collaborators.length > 0 ? (
          <span className="flex -space-x-1" aria-hidden>
            {collaborators.slice(0, 3).map((collaborator) => (
              <span
                key={`${collaborator.presenceKey}-${collaborator.userId}`}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--cv-panel)] bg-[var(--cv-accent)] text-[9px] font-semibold text-white"
              >
                {initials(collaborator.displayName)}
              </span>
            ))}
            {collaborators.length > 3 ? (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--cv-panel)] bg-[var(--cv-hover)] text-[9px] font-semibold text-[var(--cv-text-muted)]">
                +{collaborators.length - 3}
              </span>
            ) : null}
          </span>
        ) : (
          <Users className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        )}
        <Icon className={`h-3.5 w-3.5 ${iconClass}`} aria-hidden />
        <span className="hidden text-[10px] font-medium sm:inline">{collaborators.length || compactLabel}</span>
      </div>
    </WithHoverTooltip>
  );
});
