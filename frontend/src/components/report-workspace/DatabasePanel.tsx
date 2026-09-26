import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface Props<T> {
  reports: T[];
  searchPlaceholder: string;
  match: (report: T, query: string) => boolean;
  renderItem: (report: T) => ReactNode;
  filterSlot?: ReactNode;
}

export default function DatabasePanel<T>({ reports, searchPlaceholder, match, renderItem, filterSlot }: Props<T>) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => match(report, q));
  }, [reports, query, match]);

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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} />
        </label>
        {filterSlot}
      </div>

      <div className="tr-list">
        {filtered.map((report) => renderItem(report))}
        {filtered.length === 0 && (
          <div className="tr-empty">No hay informes para mostrar</div>
        )}
      </div>
    </aside>
  );
}
