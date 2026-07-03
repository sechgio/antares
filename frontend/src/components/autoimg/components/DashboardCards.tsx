import { AlertCircle, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface DashboardCardsProps {
  total?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
}

const ITEMS: {
  key: 'total' | 'completos' | 'faltantes' | 'sobrantes';
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  accent: string;
  accentBg: string;
}[] = [
  {
    key: 'total',
    label: 'Total NIS',
    icon: Layers,
    accent: 'var(--text-secondary)',
    accentBg: 'color-mix(in srgb, var(--text-secondary) 12%, transparent)',
  },
  {
    key: 'completos',
    label: 'Completos',
    icon: CheckCircle2,
    accent: 'var(--accent-green)',
    accentBg: 'color-mix(in srgb, var(--accent-green) 14%, transparent)',
  },
  {
    key: 'faltantes',
    label: 'Faltantes',
    icon: AlertCircle,
    accent: 'var(--accent-red)',
    accentBg: 'color-mix(in srgb, var(--accent-red) 14%, transparent)',
  },
  {
    key: 'sobrantes',
    label: 'Sobrantes',
    icon: AlertTriangle,
    accent: 'var(--accent-yellow)',
    accentBg: 'color-mix(in srgb, var(--accent-yellow) 14%, transparent)',
  },
];

export default function DashboardCards({
  total = 0,
  completos = 0,
  faltantes = 0,
  sobrantes = 0,
}: DashboardCardsProps) {
  const values = { total, completos, faltantes, sobrantes };
  const completionPct = total > 0 ? Math.round((completos / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-medium text-[var(--text-primary)]">Resumen</h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Estado general del padrón de imágenes
          </p>
        </div>
        {total > 0 && (
          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Completitud
            </p>
            <p className="text-lg font-light tabular-nums text-[var(--accent-green)]">
              {completionPct}%
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const value = values[item.key] ?? 0;
          const pct = item.key !== 'total' && total > 0 ? Math.round((value / total) * 100) : null;

          return (
            <div
              key={item.key}
              className="group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 transition-colors hover:border-[var(--border-medium)]"
            >
              <div
                className="absolute inset-y-0 left-0 w-0.5 rounded-full opacity-80"
                style={{ backgroundColor: item.accent }}
              />
              <div className="flex items-start justify-between gap-3 pl-1">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {item.label}
                  </p>
                  <p className="mt-1.5 text-2xl font-light tabular-nums tracking-tight text-[var(--text-primary)]">
                    {value.toLocaleString('es-MX')}
                  </p>
                  {pct !== null && (
                    <p className="mt-1 text-[10px] tabular-nums text-[var(--text-muted)]">
                      {pct}% del total
                    </p>
                  )}
                </div>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: item.accentBg, color: item.accent }}
                >
                  <Icon size={15} strokeWidth={1.75} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {total > 0 && (
        <div className="sm:hidden">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>Completitud</span>
            <span className="tabular-nums text-[var(--accent-green)]">{completionPct}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--border-medium)]">
            <div
              className="h-full rounded-full bg-[var(--accent-green)] transition-all duration-500"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
