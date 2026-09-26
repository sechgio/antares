import { useMemo, useState } from 'react';
import ThemedSelect from '@/components/ui/ThemedSelect';
import SharedDatabasePanel from '../report-workspace/DatabasePanel';
import ReportListItem from '../report-workspace/ReportListItem';
import type { TechnicalReportListItem } from './types';

interface Props {
  reports: TechnicalReportListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DatabasePanel({ reports, selectedId, onSelect }: Props) {
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

  return (
    <SharedDatabasePanel
      reports={reports}
      searchPlaceholder="Buscar informe"
      match={(report, q) => (
        (!cs || report.header.cs === cs)
        && (
          !q
          || report.id.toLowerCase().includes(q)
          || String(report.metadata.informe_id).includes(q)
          || report.header.cs.toLowerCase().includes(q)
          || report.header.codigo_infraestructura.toLowerCase().includes(q)
        )
      )}
      filterSlot={
        <ThemedSelect
          value={cs}
          onChange={setCs}
          options={csSelectOptions}
          aria-label="Filtrar por C.S."
        />
      }
      renderItem={(report) => (
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
      )}
    />
  );
}
