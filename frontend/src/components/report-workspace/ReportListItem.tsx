import type { ReportStatus } from '../../types/reports';

interface Props {
  id: string;
  informeId: number;
  main: string;
  sub: string;
  status: ReportStatus;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function ReportListItem({ id, informeId, main, sub, status, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`tr-list-item ${selected ? 'active' : ''}`}
      onClick={() => onSelect(id)}
    >
      <span className="tr-list-code">#{informeId}</span>
      <span className="tr-list-main">{main}</span>
      <span className="tr-list-sub">{sub}</span>
      <span className={`tr-status ${status}`}>{status === 'completed' ? 'Listo' : 'Borrador'}</span>
    </button>
  );
}
