import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { Database, Search } from 'lucide-react';
import {
  filterBdImgRows,
  getBdImgDataRows,
  rowEstado,
  rowEstadoType,
  type EstadoFilter,
} from '../utils/bdImgTableUtils';
import { EmptyState, EstadoBadge, ImgSlot, PanelHeader, PanelShell } from './shared';

const ROW_HEIGHT = 42;
const ROW_GRID =
  'grid grid-cols-[88px_72px_minmax(100px,1fr)_28px_28px_28px_40px_88px_minmax(100px,1fr)] items-center gap-2';

const COLUMNS = ['NIS', 'SGIO', 'Nombre', '1', '2', '3', 'Cant.', 'Estado', 'Origen'] as const;

interface BdImgTableProps {
  rows: string[][];
  showTitle?: boolean;
}

interface RowData {
  filtered: string[][];
}

type RowComponentProps = {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: React.CSSProperties;
} & RowData;

const BdImgRow = React.memo(function BdImgRow({ index, style, filtered }: RowComponentProps) {
  const row = filtered[index];
  if (!row) return <div style={style} />;

  return (
    <div
      style={style}
      className={`${ROW_GRID} border-b border-[var(--border-subtle)]/50 px-4 transition-colors hover:bg-[var(--bg-elevated)]/50`}
    >
      <span className="truncate font-mono text-[12px] text-[var(--text-primary)]">{row[0]}</span>
      <span className="truncate text-[var(--text-muted)]">{row[1] || '—'}</span>
      <span className="truncate text-[var(--text-secondary)]">{row[3] || '—'}</span>
      <span className="flex justify-center"><ImgSlot value={row[5]} /></span>
      <span className="flex justify-center"><ImgSlot value={row[6]} /></span>
      <span className="flex justify-center"><ImgSlot value={row[7]} /></span>
      <span className="text-center tabular-nums text-[var(--text-secondary)]">{row[8]}</span>
      <span><EstadoBadge estado={rowEstado(row)} /></span>
      <span className="truncate text-[var(--text-muted)]">{row[10] || '—'}</span>
    </div>
  );
});

export default function BdImgTable({ rows, showTitle = true }: BdImgTableProps) {
  const [filter, setFilter] = useState<EstadoFilter>('all');
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setListHeight(Math.floor(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const filters: { id: EstadoFilter; label: string; count: number; accent?: string }[] = [
    { id: 'all', label: 'Todos', count: counts.all },
    { id: 'completo', label: 'Completos', count: counts.completo, accent: 'var(--accent-green)' },
    { id: 'faltante', label: 'Faltantes', count: counts.faltante, accent: 'var(--accent-red)' },
    { id: 'sobrante', label: 'Sobrantes', count: counts.sobrante, accent: 'var(--accent-yellow)' },
  ];

  const rowProps = useMemo<RowData>(() => ({ filtered }), [filtered]);
  const hasData = dataRows.length > 0;

  const searchField = (
    <div className={`relative min-w-[180px] max-w-xs flex-1 ${showTitle ? '' : ''}`}>
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar NIS, SGIO, nombre…"
        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-active)] focus:shadow-[0_0_0_2px_var(--accent-primary-glow)]"
      />
    </div>
  );

  return (
    <PanelShell>
      {showTitle ? (
        <PanelHeader
          icon={Database}
          title="Padrón de imágenes"
          meta={
            hasData ? (
              <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                {filtered.length}
                {filter !== 'all' || search ? ` / ${counts.all}` : ''}
              </span>
            ) : undefined
          }
          action={searchField}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          {searchField}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-subtle)] px-4 py-2.5">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border-medium)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-secondary)]'
              }`}
            >
              {f.accent && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: f.accent, opacity: active || f.count > 0 ? 1 : 0.4 }}
                />
              )}
              {f.label}
              {hasData && (
                <span
                  className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${
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

      {filtered.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={`${ROW_GRID} shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 px-4 py-2.5`}
          >
            {COLUMNS.map((col) => (
              <span
                key={col}
                className={`text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] ${
                  ['1', '2', '3', 'Cant.'].includes(col) ? 'text-center' : ''
                }`}
              >
                {col}
              </span>
            ))}
          </div>
          <div ref={containerRef} className="min-h-0 flex-1">
            {listHeight > 0 && (
              <List
                rowCount={filtered.length}
                rowHeight={ROW_HEIGHT}
                defaultHeight={listHeight}
                overscanCount={10}
                rowComponent={BdImgRow as (props: RowComponentProps) => React.ReactElement | null}
                rowProps={rowProps}
                style={{ height: listHeight, width: '100%' }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={Database}
            title={hasData ? 'Sin coincidencias' : 'Sin datos en el padrón'}
            description={
              hasData
                ? 'Prueba otro filtro o término de búsqueda.'
                : 'Conecta Google, vincula el Sheet y sincroniza para ver los registros NIS.'
            }
          />
        </div>
      )}
    </PanelShell>
  );
}
