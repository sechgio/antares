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
    <div className="rounded-xl border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function EstadoBadge({ estado }: { estado: string }) {
  if (estado.includes('🟢') || estado.toUpperCase().includes('COMPLETO')) {
    return <span className="text-[11px] text-emerald-400/90">Completo</span>;
  }
  if (estado.includes('🔴') || estado.toUpperCase().includes('FALTANTE')) {
    return <span className="text-[11px] text-red-400/90">Faltante</span>;
  }
  if (estado.includes('🟡') || estado.toUpperCase().includes('SOBRANTE')) {
    return <span className="text-[11px] text-amber-400/90">Sobrante</span>;
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

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[13px] text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

export const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)]';