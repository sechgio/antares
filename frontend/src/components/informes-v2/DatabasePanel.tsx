import SharedDatabasePanel from '../report-workspace/DatabasePanel';
import ReportListItem from '../report-workspace/ReportListItem';
import type { InformeV2ListItem } from './types';

interface Props {
  reports: InformeV2ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DatabasePanel({ reports, selectedId, onSelect }: Props) {
  return (
    <SharedDatabasePanel
      reports={reports}
      searchPlaceholder="Buscar estación / ID / NIS"
      match={(report, q) => (
        report.id.toLowerCase().includes(q)
        || String(report.metadata.informe_id).includes(q)
        || report.header.estacion.toLowerCase().includes(q)
        || report.header.suministro.toLowerCase().includes(q)
        || report.header.photo_id.toLowerCase().includes(q)
        || report.header.distrito.toLowerCase().includes(q)
      )}
      renderItem={(report) => (
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
      )}
    />
  );
}
