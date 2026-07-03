import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  filterBdImgRows,
  getBdImgDataRows,
  rowEstado,
  type EstadoFilter,
} from '../utils/bdImgTableUtils';
import { EmptyState, EstadoBadge, ImgSlot } from './shared';

interface BdImgTableProps {
  rows: string[][];
}

export default function BdImgTable({ rows }: BdImgTableProps) {
  const [filter, setFilter] = useState<EstadoFilter>('all');
  const [search, setSearch] = useState('');

  const dataRows = useMemo(() => getBdImgDataRows(rows), [rows]);
  const filtered = useMemo(() => filterBdImgRows(dataRows, filter, search), [dataRows, filter, search]);

  const filters: { id: EstadoFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'completo', label: 'Completos' },
    { id: 'faltante', label: 'Faltantes' },
    { id: 'sobrante', label: 'Sobrantes' },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">BD_IMG</span>
        <div className="relative ml-auto min-w-[180px] flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[var(--border-medium)]"
          />
        </div>
      </div>

      <div className="flex gap-4 border-b border-[var(--border-subtle)] px-4">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`relative py-2.5 text-[11px] transition-colors ${
              filter === f.id
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {f.label}
            {filter === f.id && <span className="absolute inset-x-0 -bottom-px h-px bg-[var(--text-primary)]" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length > 0 ? (
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="sticky top-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <tr>
                {['NIS', 'SGIO', 'Nombre', '1', '2', '3', 'Cant.', 'Estado', 'Origen'].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-[10px] font-normal uppercase tracking-wider text-[var(--text-muted)]">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={`${row[0]}-${i}`} className="border-b border-[var(--border-subtle)]/50 transition-colors hover:bg-[var(--bg-elevated)]/30">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-primary)]">{row[0]}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{row[1] || '—'}</td>
                  <td className="max-w-[140px] truncate px-4 py-2.5">{row[3] || '—'}</td>
                  <td className="px-4 py-2.5 text-center"><ImgSlot value={row[5]} /></td>
                  <td className="px-4 py-2.5 text-center"><ImgSlot value={row[6]} /></td>
                  <td className="px-4 py-2.5 text-center"><ImgSlot value={row[7]} /></td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-[var(--text-secondary)]">{row[8]}</td>
                  <td className="px-4 py-2.5"><EstadoBadge estado={rowEstado(row)} /></td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 text-[var(--text-muted)]">{row[10] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Sin datos"
            description="Conecta Google y sincroniza el Sheet."
          />
        )}
      </div>
    </div>
  );
}