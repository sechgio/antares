import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function EstadoBadge({ estado }: { estado: string }) {
  if (estado.includes('🟢') || estado.toUpperCase().includes('COMPLETO')) {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        Completo
      </span>
    );
  }
  if (estado.includes('🔴') || estado.toUpperCase().includes('FALTANTE')) {
    return (
      <span className="inline-flex items-center rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
        Faltante
      </span>
    );
  }
  if (estado.includes('🟡') || estado.toUpperCase().includes('SOBRANTE')) {
    return (
      <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
        Sobrante
      </span>
    );
  }
  return <span className="text-[11px] text-[var(--text-muted)]">{estado || '—'}</span>;
}

export function ImgSlot({ value }: { value: string }) {
  const ok = value === '✅';
  return (
    <span className={`text-[11px] ${ok ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]/50'}`}>
      {ok ? '·' : '—'}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
          <Icon size={18} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1.5 max-w-[280px] text-[11px] leading-relaxed text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

export const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)]';

export const INPUT_SM_CLASS =
  'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-active)]';

export function SidebarShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</p>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </div>
  );
}

export function SidebarSection({
  icon: Icon,
  title,
  badge,
  muted,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge?: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`px-4 py-3.5 ${muted ? 'opacity-60' : ''}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={13} className="shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{title}</span>
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

export function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
        ok
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
      }`}
    >
      <span className={`h-1 w-1 rounded-full ${ok ? 'bg-emerald-400' : 'bg-[var(--text-muted)]'}`} />
      {label}
    </span>
  );
}

export function InlineMessage({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500/20 bg-red-500/5 text-red-400',
    success: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    info: 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]',
  };
  return (
    <p className={`mt-2.5 rounded-md border px-2.5 py-1.5 text-[10px] leading-relaxed ${styles[tone]}`}>
      {children}
    </p>
  );
}