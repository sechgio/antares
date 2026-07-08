import { CoverageRail } from './shared';

interface DashboardCardsProps {
  total?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
  sinSgio?: number;
}

const fmt = (n: number) => n.toLocaleString('es-MX');

export default function DashboardCards({
  total = 0,
  completos = 0,
  faltantes = 0,
  sobrantes = 0,
  sinSgio = 0,
}: DashboardCardsProps) {
  const completionPct = total > 0 ? Math.round((completos / total) * 100) : 0;

  const legend = [
    { label: 'Completos', value: completos, color: 'var(--accent-green)' },
    { label: 'Faltantes', value: faltantes, color: 'var(--accent-red)' },
    { label: 'Sobrantes', value: sobrantes, color: 'var(--accent-yellow)' },
    { label: 'Sin SGIO', value: sinSgio, color: 'var(--accent-primary)' },
  ].filter((item) => item.value > 0);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 text-[13px] text-[var(--text-secondary)]">
          {total > 0 ? (
            <>
              <span className="tabular-nums text-[var(--text-primary)]">{fmt(completos)}</span>
              <span className="text-[var(--text-muted)]"> / {fmt(total)}</span>
              <span className="ml-1.5 text-[var(--text-muted)]">completos</span>
            </>
          ) : (
            <span className="text-[var(--text-muted)]">Sin datos de cobertura</span>
          )}
        </p>
        {total > 0 && (
          <p className="shrink-0 text-[13px] tabular-nums tracking-tight text-[var(--text-primary)]">
            {completionPct}
            <span className="text-[var(--text-muted)]">%</span>
          </p>
        )}
      </div>

      <div className="mt-2.5">
        <CoverageRail
          total={total}
          completos={completos}
          faltantes={faltantes}
          sobrantes={sobrantes}
          sinSgio={sinSgio}
        />
      </div>

      {legend.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {legend.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              {item.label}
              <span className="tabular-nums text-[var(--text-secondary)]">{fmt(item.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
