import { FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FichaTecnicaListItem } from './types';

type StatusFilter = 'all' | 'draft' | 'completed';

interface Props {
  fichas: FichaTecnicaListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Normalize list dates: strip midnight timestamps, prefer DD/MM/YYYY. */
function formatListDate(value: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = raw.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (dmy) return dmy[1];
  return raw.split(/[\sT]/)[0];
}

function initialsFromClient(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function DatabasePanel({ fichas, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const counts = useMemo(
    () => ({
      draft: fichas.filter((f) => f.status === 'draft').length,
      completed: fichas.filter((f) => f.status === 'completed').length,
    }),
    [fichas],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fichas.filter((ficha) => {
      if (statusFilter !== 'all' && ficha.status !== statusFilter) return false;
      if (!q) return true;
      return (
        ficha.id.toLowerCase().includes(q) ||
        (ficha.os_numero || '').toLowerCase().includes(q) ||
        (ficha.cliente || '').toLowerCase().includes(q) ||
        (ficha.distrito || '').toLowerCase().includes(q) ||
        (ficha.direccion || '').toLowerCase().includes(q)
      );
    });
  }, [fichas, query, statusFilter]);

  const filterOptions: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todas', count: fichas.length },
    { id: 'draft', label: 'Borrador', count: counts.draft },
    { id: 'completed', label: 'Listas', count: counts.completed },
  ];

  return (
    <aside className="tr-panel tr-database ft-db">
      <div className="ft-db-header">
        <div className="ft-db-header-top">
          <div className="ft-db-brand">
            <p className="ft-db-eyebrow">Base local</p>
            <h2 className="ft-db-title">
              {fichas.length} ficha{fichas.length === 1 ? '' : 's'}
            </h2>
          </div>
          {fichas.length > 0 && (
            <div className="ft-db-stats" aria-label="Resumen de estado">
              <span className="ft-db-stat ft-db-stat--done">{counts.completed} listas</span>
              <span className="ft-db-stat ft-db-stat--draft">{counts.draft} borrador</span>
            </div>
          )}
        </div>

        <label className="ft-db-search">
          <Search size={12} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar fichas"
          />
        </label>

        <div className="ft-db-filters" role="tablist" aria-label="Filtrar por estado">
          {filterOptions.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`ft-db-filter${active ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(option.id)}
              >
                <span className="ft-db-filter-label">{option.label}</span>
                <span className="ft-db-filter-count tabular-nums">{option.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ft-db-list" role="list">
        {filtered.map((ficha) => {
          const code = ficha.os_numero || ficha.id;
          const cliente = ficha.cliente?.trim() || 'Sin cliente';
          const direccion = ficha.direccion?.trim() || '';
          const distrito = ficha.distrito?.trim() || '';
          const fecha = formatListDate(ficha.fecha);
          const location = distrito || direccion;
          const isActive = selectedId === ficha.id;
          const isDone = ficha.status === 'completed';
          const statusLabel = isDone ? 'Lista' : 'Borrador';

          return (
            <button
              key={ficha.id}
              type="button"
              role="listitem"
              className={`ft-db-card ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : 'is-draft'}`}
              onClick={() => onSelect(ficha.id)}
              title={[cliente, code, location, fecha].filter(Boolean).join(' — ')}
            >
              <span className="ft-db-avatar" aria-hidden="true">
                {initialsFromClient(cliente)}
              </span>

              <span className="ft-db-card-main">
                <span className="ft-db-card-row ft-db-card-row--top">
                  <span className="ft-db-client">{cliente}</span>
                  <span className={`ft-db-pill ${ficha.status}`}>{statusLabel}</span>
                </span>

                <span className="ft-db-card-row ft-db-card-row--bottom">
                  <span className="ft-db-code">{code}</span>
                  {location ? (
                    <span className="ft-db-location">
                      <span className="ft-db-location-text">{location}</span>
                    </span>
                  ) : (
                    <span className="ft-db-location ft-db-location--empty">Sin ubicación</span>
                  )}
                  {fecha ? <span className="ft-db-date">{fecha}</span> : null}
                </span>
              </span>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="ft-db-empty">
            {fichas.length === 0 ? (
              <>
                <FileText size={18} strokeWidth={1.5} />
                <p>No hay fichas</p>
                <span>Importa un archivo o crea una nueva.</span>
              </>
            ) : (
              <>
                <Search size={18} strokeWidth={1.5} />
                <p>Sin resultados</p>
                <span>Prueba otro término o filtro.</span>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
