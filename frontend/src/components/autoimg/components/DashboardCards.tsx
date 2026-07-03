interface DashboardCardsProps {
  total?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
}

const ITEMS = [
  { key: 'total' as const, label: 'Total' },
  { key: 'completos' as const, label: 'Completos' },
  { key: 'faltantes' as const, label: 'Faltantes' },
  { key: 'sobrantes' as const, label: 'Sobrantes' },
];

export default function DashboardCards({ total = 0, completos = 0, faltantes = 0, sobrantes = 0 }: DashboardCardsProps) {
  const values = { total, completos, faltantes, sobrantes };

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--border-subtle)] lg:grid-cols-4">
      {ITEMS.map((item) => (
        <div key={item.key} className="bg-[var(--bg-base)] px-5 py-4">
          <p className="text-[11px] text-[var(--text-muted)]">{item.label}</p>
          <p className="mt-1 text-2xl font-light tabular-nums tracking-tight text-[var(--text-primary)]">
            {values[item.key] ?? 0}
          </p>
        </div>
      ))}
    </div>
  );
}