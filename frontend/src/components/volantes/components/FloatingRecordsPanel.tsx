import type { FlyerRecord, LayoutMode } from "../types";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import FloatingPanelFrame from "./FloatingPanelFrame";

interface FloatingRecordsPanelProps {
  records: FlyerRecord[];
  selectedRecordId: string | null;
  filterText: string;
  onFilterChange: (text: string) => void;
  onSelectRecord: (id: string) => void;
  onAddRecord: () => void;
  onDeleteRecord: (id: string) => void;
  onExportSingle: (record: FlyerRecord, mode: LayoutMode) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function FloatingRecordsPanel({
  records,
  selectedRecordId,
  filterText,
  onFilterChange,
  onSelectRecord,
  onAddRecord,
  onDeleteRecord,
  onExportSingle,
  isOpen,
  onClose,
}: FloatingRecordsPanelProps) {
  const {
    panelRef,
    position,
    isDragging,
    isPinned,
    handleMouseDown,
    handlePinToggle,
    handleResetPosition,
  } = useFloatingPanel({
    isOpen,
    panelWidth: 320,
    storageKeyPosition: "vgen-records-panel-position",
    storageKeyPinned: "vgen-records-panel-pinned",
    ignoreSelector: "button, input, .vgen-record-item, .vgen-search",
  });

  const filteredRecords = filterText.trim()
    ? records.filter((r) => {
        const q = filterText.toLowerCase();
        return (
          r.reservorio.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q) ||
          r.zonasAfectadas.toLowerCase().includes(q)
        );
      })
    : records;

  if (!isOpen) return null;

  return (
    <FloatingPanelFrame
      panelRef={panelRef}
      position={position}
      isDragging={isDragging}
      isPinned={isPinned}
      onMouseDown={handleMouseDown}
      onPinToggle={handlePinToggle}
      onResetPosition={handleResetPosition}
      onClose={onClose}
      className="vgen-records-panel"
      title={(
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <span>Lotes ({records.length})</span>
        </>
      )}
    >
      <div className="vgen-floating-panel-content vgen-records-content">
        <div className="vgen-actions-row">
          <div className="vgen-search">
            <input className="vgen-input" onChange={(e) => onFilterChange(e.target.value)} placeholder="Buscar reservorio..." type="text" value={filterText} />
          </div>
          <button className="v-btn v-btn-outline vgen-new-btn" onClick={onAddRecord}>
            + Nuevo
          </button>
        </div>

        <div className="vgen-record-list">
          {filteredRecords.length === 0 && (
            <div className="vgen-empty-state">No se encontraron registros.</div>
          )}

          {filteredRecords.map((record) => (
            <div
              key={record.id}
              className={`vgen-record-item ${record.id === selectedRecordId ? "active" : ""}`}
              onClick={() => onSelectRecord(record.id)}
            >
              <div className="vgen-record-info">
                <h4>{record.reservorio}</h4>
              </div>

              <div className="vgen-record-actions" onClick={(e) => e.stopPropagation()}>
                <WithHoverTooltip label="Descargar 2 por hoja" placement="bottom">
                  <button className="v-icon-btn" onClick={() => onExportSingle(record, "2-up")}>2↓</button>
                </WithHoverTooltip>
                <WithHoverTooltip label="Descargar 3 por hoja" placement="bottom">
                  <button className="v-icon-btn" onClick={() => onExportSingle(record, "3-up")}>3↓</button>
                </WithHoverTooltip>
                <WithHoverTooltip label="Eliminar" placement="bottom">
                  <button className="v-icon-btn danger" onClick={() => onDeleteRecord(record.id)} aria-label="Eliminar">×</button>
                </WithHoverTooltip>
              </div>
            </div>
          ))}
        </div>
      </div>

    </FloatingPanelFrame>
  );
}
