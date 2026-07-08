import type { LucideIcon } from 'lucide-react';
import Button from '../../ui/Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full bg-[var(--accent-primary)]/6 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] shadow-[0_8px_24px_color-mix(in_srgb,var(--bg-base)_50%,transparent)]">
          <Icon className="h-8 w-8 text-[var(--accent-primary-hover)]" strokeWidth={1.5} />
        </div>
      </div>

      <div className="max-w-sm space-y-2">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
      </div>

      {actionLabel && onAction && (
        <Button type="button" onClick={onAction} className="gap-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}