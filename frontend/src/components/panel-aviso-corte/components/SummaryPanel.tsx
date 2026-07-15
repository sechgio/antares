import type { MatchResult } from '../types';

interface Props {
  result: MatchResult | null;
  exportMode: 'skip_empty' | 'include_empty';
  onExportModeChange: (mode: 'skip_empty' | 'include_empty') => void;
}

interface StatProps {
  label: string;
  value: number;
  warn?: boolean;
}

function Stat({ label, value, warn }: StatProps) {
  const valueClass = warn && value > 0 ? 'pac-stat__value pac-stat__value--warn' : 'pac-stat__value';
  return (
    <div className="pac-stat">
      <span className="pac-stat__label">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

export default function SummaryPanel({ result, exportMode, onExportModeChange }: Props) {
  if (!result) return null;
  const s = result.summary;
  return (
    <div className="pac-summary">
      <div className="pac-summary__header">
        <span className="pac-summary__title">Emparejamiento</span>
        <select
          aria-label="Modo de exportación"
          className="pac-summary__select"
          value={exportMode}
          onChange={(e) => onExportModeChange(e.target.value as 'skip_empty' | 'include_empty')}
        >
          <option value="skip_empty">Omitir vacíos</option>
          <option value="include_empty">Incluir vacíos</option>
        </select>
      </div>
      <div className="pac-summary-stats">
        <Stat label="Filas" value={s.totalRows} />
        <Stat label="Con imágenes" value={s.rowsWithImages} />
        <Stat label="Imágenes" value={s.totalImages} />
        <Stat label="Sin emparejar" value={s.unmatchedImages} warn />
      </div>
      {result.warnings.length > 0 && (
        <div className="pac-summary__section">
          {result.warnings.map((w, i) => (
            <span key={i} className="text-[10px] leading-snug text-[var(--accent-yellow)]">{w}</span>
          ))}
        </div>
      )}
      {s.unmatchedImageNames.length > 0 && (
        <div className="pac-summary__section">
          <span className="pac-summary__section-title">Sin emparejar</span>
          <div className="flex flex-wrap gap-1">
            {s.unmatchedImageNames.map((n) => (
              <span key={n} className="pac-summary__tag">{n}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
