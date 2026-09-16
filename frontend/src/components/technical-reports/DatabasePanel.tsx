import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import ThemedSelect from '@/components/ui/ThemedSelect';
import ReportListItem from '../report-workspace/ReportListItem';
import type { TechnicalReportListItem } from './types';

interface Props {
  reports: TechnicalReportListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DatabasePanel({ reports, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [cs, setCs] = useState('');

  const csOptions = useMemo(() => {
    return [...new Set(reports.map((report) => report.header.cs).filter(Boolean))].sort();
  }, [reports]);

  const csSelectOptions = useMemo(
    () => [
      { value: '', label: 'Todos los C.S.' },
      ...csOptions.map((option) => ({ value: option, label: option })),
    ],
    [csOptions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesCs = !cs || report.header.cs === cs;
      const matchesQuery = !q
        || report.id.toLowerCase().includes(q)
        || String(report.metadata.informe_id).includes(q)
        || report.header.cs.toLowerCase().includes(q)
        || report.header.codigo_infraestructura.toLowerCase().includes(q);
      return matchesCs && matchesQuery;
    });
  }, [reports, query, cs]);

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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar informe" />
        </label>
        <ThemedSelect
          value={cs}
          onChange={setCs}
          options={csSelectOptions}
          aria-label="Filtrar por C.S."
        />
      </div>

      <div className="tr-list">
        {filtered.map((report) => (
          <ReportListItem
            key={report.id}
            id={report.id}
            informeId={report.metadata.informe_id}
            main={report.header.cs || 'Sin C.S.'}
            sub={report.header.codigo_infraestructura || report.id}
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
