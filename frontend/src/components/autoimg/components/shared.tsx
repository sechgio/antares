import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function SectionCard({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium tracking-tight text-[var(--text-primary)]">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0 pt-0.5">{action}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function PanelShell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={14} className="shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />}
        <span className="text-[12px] font-medium text-[var(--text-primary)]">{title}</span>
        {meta}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

type EstadoTone = 'completo' | 'faltante' | 'sobrante' | 'neutral';

function resolveEstadoTone(estado: string): EstadoTone {
  const upper = estado.toUpperCase();
  if (estado.includes('🟢') || upper.includes('COMPLETO')) return 'completo';
  if (estado.includes('🔴') || upper.includes('FALTANTE')) return 'faltante';
  if (estado.includes('🟡') || upper.includes('SOBRANTE')) return 'sobrante';
  return 'neutral';
}

const ESTADO_STYLES: Record<EstadoTone, { label: string; className: string; dot: string }> = {
  completo: {
    label: 'Completo',
    className: 'bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] text-[var(--accent-green)]',
    dot: 'bg-[var(--accent-green)]',
  },
  faltante: {
    label: 'Faltante',
    className: 'bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)] text-[var(--accent-red)]',
    dot: 'bg-[var(--accent-red)]',
  },
  sobrante: {
    label: 'Sobrante',
    className: 'bg-[color-mix(in_srgb,var(--accent-yellow)_12%,transparent)] text-[var(--accent-yellow)]',
    dot: 'bg-[var(--accent-yellow)]',
  },
  neutral: {
    label: '',
    className: 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
    dot: 'bg-[var(--text-muted)]',
  },
};

export function EstadoBadge({ estado }: { estado: string }) {
  const tone = resolveEstadoTone(estado);
  if (tone === 'neutral') {
    return <span className="text-[11px] text-[var(--text-muted)]">{estado || '—'}</span>;
  }
  const style = ESTADO_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium ${style.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

/** Three-frame image presence indicator (slot 1–3). */
export function ImgSlot({ value }: { value: string }) {
  const ok = value === '✅' || value === '1' || value?.toLowerCase() === 'true';
  return (
    <span
      className={`mx-auto block h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ${
        ok
          ? 'bg-[var(--accent-secondary)] ring-[color-mix(in_srgb,var(--accent-secondary)_40%,transparent)]'
          : 'bg-transparent ring-[var(--border-medium)]'
      }`}
      title={ok ? 'Imagen presente' : 'Sin imagen'}
      aria-label={ok ? 'Imagen presente' : 'Sin imagen'}
    />
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
          <Icon size={18} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1.5 max-w-[300px] text-[11px] leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-active)] focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]';

export const INPUT_SM_CLASS =
  'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-active)] focus:shadow-[0_0_0_2px_var(--accent-primary-glow)]';

export function SidebarShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-subtle)] px-3.5 py-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {title}
        </p>
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
    <section className={`px-3.5 py-3 ${muted ? 'opacity-50' : ''}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className="shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
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
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
        ok
          ? 'bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] text-[var(--accent-green)]'
          : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[var(--accent-green)]' : 'bg-[var(--text-muted)]'}`} />
      {label}
    </span>
  );
}

export function InlineMessage({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-[color-mix(in_srgb,var(--accent-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-red)_8%,transparent)] text-[var(--accent-red)]',
    success:
      'border-[color-mix(in_srgb,var(--accent-green)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-green)_8%,transparent)] text-[var(--accent-green)]',
    info: 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]',
  };
  return (
    <p className={`mt-2.5 rounded-lg border px-2.5 py-1.5 text-[10px] leading-relaxed ${styles[tone]}`}>
      {children}
    </p>
  );
}

export function CoverageRail({
  total,
  completos,
  faltantes,
  sobrantes,
  sinSgio = 0,
}: {
  total: number;
  completos: number;
  faltantes: number;
  sobrantes: number;
  sinSgio?: number;
}) {
  if (total <= 0) {
    return <div className="h-px w-full bg-[var(--border-medium)]" aria-hidden />;
  }

  const segments = [
    { key: 'completos', value: completos, color: 'var(--accent-green)' },
    { key: 'faltantes', value: faltantes, color: 'var(--accent-red)' },
    { key: 'sobrantes', value: sobrantes, color: 'var(--accent-yellow)' },
    { key: 'sinSgio', value: sinSgio, color: 'var(--accent-primary)' },
  ].filter((s) => s.value > 0);

  return (
    <div
      className="flex h-1 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]"
      role="img"
      aria-label={`Cobertura: ${completos} completos, ${faltantes} faltantes, ${sobrantes} sobrantes`}
    >
      {segments.map((seg) => (
        <div
          key={seg.key}
          className="h-full min-w-px transition-[width] duration-500 ease-out"
          style={{
            width: `${(seg.value / total) * 100}%`,
            backgroundColor: seg.color,
          }}
        />
      ))}
    </div>
  );
}

export function ActionButton({
  variant = 'secondary',
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid';
}) {
  const variants = {
    primary:
      'bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-40',
    solid:
      'bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 disabled:opacity-40',
    secondary:
      'border border-[var(--border-medium)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40',
    ghost:
      'text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40',
    danger:
      'border border-[color-mix(in_srgb,var(--accent-red)_25%,transparent)] text-[var(--accent-red)] hover:bg-[color-mix(in_srgb,var(--accent-red)_8%,transparent)] disabled:opacity-40',
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)] ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
