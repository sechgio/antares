import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Save, Trash2 } from 'lucide-react';

interface Props {
  informeId: number;
  hasChanges: boolean;
  busy: boolean;
  onSave: () => void;
  onDelete: () => void;
}

export default function ReportFormHeader({ informeId, hasChanges, busy, onSave, onDelete }: Props) {
  return (
    <div className="tr-panel-header tr-form-header">
      <h2 className="tr-form-title">
        Informe #{informeId}
        <span className={`tr-change-dot ${hasChanges ? 'dirty' : ''}`} title={hasChanges ? 'Cambios sin guardar' : 'Sin cambios'} />
      </h2>
      <div className="tr-form-actions">
        <WithHoverTooltip label={hasChanges ? 'Guardar cambios' : 'Sin cambios'} placement="bottom">
          <button type="button" className="tr-form-action" onClick={onSave} disabled={!hasChanges || busy} aria-label="Guardar">
            <Save size={14} strokeWidth={2} />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Eliminar informe" placement="bottom">
          <button type="button" className="tr-form-action tr-form-action--danger" onClick={onDelete} disabled={busy} aria-label="Eliminar informe">
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </WithHoverTooltip>
      </div>
    </div>
  );
}
