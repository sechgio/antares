import { RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { TechnicalReportListItem } from './types';

interface Props {
  reports: TechnicalReportListItem[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onImport: (file: File) => void;
  onReload: () => void;
  onClear: () => void;
}

export default function DatabasePanel({ reports, selectedId, busy, onSelect, onImport, onReload, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [cs, setCs] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const csOptions = useMemo(() => {
    return [...new Set(reports.map((report) => report.header.cs).filter(Boolean))].sort();
  }, [reports]);

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

      <div className="tr-action-grid">
        <button className="tr-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={15} />
          Importar
        </button>
        <button className="tr-secondary" disabled={busy} onClick={onReload} title="Recargar">
          <RefreshCw size={15} />
        </button>
        <button className="tr-danger" disabled={busy || reports.length === 0} onClick={onClear} title="Eliminar todos">
          <Trash2 size={15} />
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onImport(file);
          }}
        />
      </div>

      <div className="tr-filter-block">
        <label className="tr-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar informe" />
        </label>
        <select value={cs} onChange={(event) => setCs(event.target.value)}>
          <option value="">Todos los C.S.</option>
          {csOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      <div className="tr-list">
        {filtered.map((report) => (
          <button
            key={report.id}
            className={`tr-list-item ${selectedId === report.id ? 'active' : ''}`}
            onClick={() => onSelect(report.id)}
          >
            <span className="tr-list-code">#{report.metadata.informe_id}</span>
            <span className="tr-list-main">{report.header.cs || 'Sin C.S.'}</span>
            <span className="tr-list-sub">{report.header.codigo_infraestructura || report.id}</span>
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
