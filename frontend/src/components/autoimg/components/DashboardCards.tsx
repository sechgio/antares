import { AlertCircle, AlertTriangle, CheckCircle2, Layers, UserX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CoverageRail } from './shared';

interface DashboardCardsProps {
  total?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
  sinSgio?: number;
}

const ITEMS: {
  key: 'total' | 'completos' | 'faltantes' | 'sobrantes' | 'sinSgio';
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;
  accentBg: string;
}[] = [
  {
    key: 'total',
    label: 'Total NIS',
    hint: 'En el padrón',
    icon: Layers,
    accent: 'var(--text-secondary)',
    accentBg: 'color-mix(in srgb, var(--text-secondary) 12%, transparent)',
  },
  {
    key: 'completos',
    label: 'Completos',
    hint: '3 imágenes',
    icon: CheckCircle2,
    accent: 'var(--accent-green)',
    accentBg: 'color-mix(in srgb, var(--accent-green) 14%, transparent)',
  },
  {
    key: 'faltantes',
    label: 'Faltantes',
    hint: 'Requieren fotos',
    icon: AlertCircle,
    accent: 'var(--accent-red)',
    accentBg: 'color-mix(in srgb, var(--accent-red) 14%, transparent)',
  },
  {
    key: 'sobrantes',
    label: 'Sobrantes',
    hint: 'Más de 3 fotos',
    icon: AlertTriangle,
    accent: 'var(--accent-yellow)',
    accentBg: 'color-mix(in srgb, var(--accent-yellow) 14%, transparent)',
  },
  {
    key: 'sinSgio',
    label: 'Sin SGIO',
    hint: 'Sin identificador',
    icon: UserX,
    accent: 'var(--accent-primary)',
    accentBg: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
  },
];

export default function DashboardCards({
  total = 0,
  completos = 0,
  faltantes = 0,
  sobrantes = 0,
  sinSgio = 0,
}: DashboardCardsProps) {
  const values = { total, completos, faltantes, sobrantes, sinSgio };
  const completionPct = total > 0 ? Math.round((completos / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Signature: coverage instrument */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Cobertura del padrón
            </p>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {total > 0
                ? `${completos.toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')} NIS con set completo`
                : 'Sin datos — sincroniza el Sheet o ejecuta un escaneo'}
            </p>
          </div>
          {total > 0 && (
            <div className="text-right">
              <p className="text-2xl font-light tabular-nums tracking-tight text-[var(--text-primary)]">
                {completionPct}
                <span className="text-sm text-[var(--text-muted)]">%</span>
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">completitud</p>
            </div>
          )}
        </div>

        <div className="mt-3">
          <CoverageRail
            total={total}
            completos={completos}
            faltantes={faltantes}
            sobrantes={sobrantes}
            sinSgio={sinSgio}
          />
        </div>

        {total > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {[
              { label: 'Completos', value: completos, color: 'var(--accent-green)' },
              { label: 'Faltantes', value: faltantes, color: 'var(--accent-red)' },
              { label: 'Sobrantes', value: sobrantes, color: 'var(--accent-yellow)' },
              { label: 'Sin SGIO', value: sinSgio, color: 'var(--accent-primary)' },
            ].map((item) => (
              <div key={item.label} className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
                <span className="tabular-nums text-[var(--text-secondary)]">
                  {item.value.toLocaleString('es-MX')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const value = values[item.key] ?? 0;
          const pct =
            item.key !== 'total' && item.key !== 'sinSgio' && total > 0
              ? Math.round((value / total) * 100)
              : null;

          return (
            <div
              key={item.key}
              className="group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3.5 transition-colors hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]"
            >
              <div
                className="absolute inset-y-0 left-0 w-0.5 opacity-90"
                style={{ backgroundColor: item.accent }}
              />
              <div className="flex items-start justify-between gap-2 pl-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xl font-light tabular-nums tracking-tight text-[var(--text-primary)]">
                    {value.toLocaleString('es-MX')}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {pct !== null ? `${pct}% del total` : item.hint}
                  </p>
                </div>
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: item.accentBg, color: item.accent }}
                >
                  <Icon size={14} strokeWidth={1.75} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
