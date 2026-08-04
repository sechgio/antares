import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InformeV2ListItem } from './types';

interface Props {
  reports: InformeV2ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DatabasePanel({ reports, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((report) => (
      report.id.toLowerCase().includes(q)
      || String(report.metadata.informe_id).includes(q)
      || report.header.estacion.toLowerCase().includes(q)
      || report.header.suministro.toLowerCase().includes(q)
      || report.header.photo_id.toLowerCase().includes(q)
      || report.header.distrito.toLowerCase().includes(q)
    ));
  }, [reports, query]);

  return (
    <aside className="tr-panel tr-database">
      <div className="tr-panel-header">
        <div>
          <p className="tr-eyebrow">Base local</p>
          <h2>{reports.length} informes</h2>
        </div>
      </div>

      <div className="tr-filter-block">
        <label className="tr-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar estación / ID / NIS" />
        </label>
      </div>

      <div className="tr-list">
        {filtered.map((report) => (
          <button
            key={report.id}
            type="button"
            className={`tr-list-item ${selectedId === report.id ? 'active' : ''}`}
            onClick={() => onSelect(report.id)}
          >
            <span className="tr-list-code">#{report.metadata.informe_id}</span>
            <span className="tr-list-main">{report.header.estacion || 'Sin estación'}</span>
            <span className="tr-list-sub">{report.header.photo_id || report.header.suministro || report.id}</span>
            <span className={`tr-status ${report.status}`}>{report.status === 'completed' ? 'Listo' : 'Borrador'}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="tr-empty">No hay informes para mostrar</div>
        )}
      </div>
    </aside>
  );
}
