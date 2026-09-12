import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReportListItem from '../report-workspace/ReportListItem';
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
          <ReportListItem
            key={report.id}
            id={report.id}
            informeId={report.metadata.informe_id}
            main={report.header.estacion || 'Sin estación'}
            sub={report.header.photo_id || report.header.suministro || report.id}
            status={report.status}
            selected={selectedId === report.id}
            onSelect={onSelect}
          />
        ))}
        {filtered.length === 0 && (
          <div className="tr-empty">No hay informes para mostrar</div>
        )}
      </div>
    </aside>
  );
}
