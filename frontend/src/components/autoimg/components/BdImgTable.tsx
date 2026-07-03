import { useMemo, useState } from 'react';
import { Database, Search } from 'lucide-react';
import {
  filterBdImgRows,
  getBdImgDataRows,
  rowEstado,
  rowEstadoType,
  type EstadoFilter,
} from '../utils/bdImgTableUtils';
import { EmptyState, EstadoBadge, ImgSlot } from './shared';

interface BdImgTableProps {
  rows: string[][];
  showTitle?: boolean;
}

export default function BdImgTable({ rows, showTitle = true }: BdImgTableProps) {
  const [filter, setFilter] = useState<EstadoFilter>('all');
  const [search, setSearch] = useState('');

  const dataRows = useMemo(() => getBdImgDataRows(rows), [rows]);
  const filtered = useMemo(() => filterBdImgRows(dataRows, filter, search), [dataRows, filter, search]);

  const counts = useMemo(() => {
    const tally = { all: dataRows.length, completo: 0, faltante: 0, sobrante: 0 };
    for (const row of dataRows) {
      const type = rowEstadoType(rowEstado(row));
      if (type === 'completo') tally.completo += 1;
      else if (type === 'faltante') tally.faltante += 1;
      else if (type === 'sobrante') tally.sobrante += 1;
    }
    return tally;
  }, [dataRows]);

  const filters: { id: EstadoFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Todos', count: counts.all },
    { id: 'completo', label: 'Completos', count: counts.completo },
    { id: 'faltante', label: 'Faltantes', count: counts.faltante },
    { id: 'sobrante', label: 'Sobrantes', count: counts.sobrante },
  ];

  const hasData = dataRows.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        {showTitle && (
          <div className="flex items-center gap-2">
            <Database size={14} className="text-[var(--text-muted)]" />
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">BD_IMG</span>
            {hasData && (
              <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-muted)]">
                {filtered.length}
                {filter !== 'all' || search ? ` / ${counts.all}` : ''}
              </span>
            )}
          </div>
        )}
        <div className={`relative min-w-[180px] flex-1 max-w-xs ${showTitle ? 'ml-auto' : ''}`}>
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar NIS, SGIO, nombre…"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-active)]"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-subtle)] px-4 py-2.5">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] ring-1 ring-[var(--border-medium)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-secondary)]'
              }`}
            >
              {f.label}
              {hasData && (
                <span
                  className={`min-w-[1.25rem] rounded px-1 text-center text-[10px] tabular-nums ${
                    active ? 'bg-[var(--bg-base)] text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {f.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length > 0 ? (
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <tr>
                {['NIS', 'SGIO', 'Nombre', '1', '2', '3', 'Cant.', 'Estado', 'Origen'].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={`${row[0]}-${i}`}
                  className="border-b border-[var(--border-subtle)]/40 transition-colors hover:bg-[var(--bg-elevated)]/40"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-primary)]">{row[0]}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{row[1] || '—'}</td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 text-[var(--text-secondary)]">
                    {row[3] || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <ImgSlot value={row[5]} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <ImgSlot value={row[6]} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <ImgSlot value={row[7]} />
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-[var(--text-secondary)]">
                    {row[8]}
                  </td>
                  <td className="px-4 py-2.5">
                    <EstadoBadge estado={rowEstado(row)} />
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 text-[var(--text-muted)]">
                    {row[10] || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={Database}
            title={hasData ? 'Sin coincidencias' : 'Sin datos'}
            description={
              hasData
                ? 'Prueba otro filtro o término de búsqueda.'
                : 'Conecta Google en el panel lateral y sincroniza el Sheet para ver los registros.'
            }
          />
        )}
      </div>
    </div>
  );
}
