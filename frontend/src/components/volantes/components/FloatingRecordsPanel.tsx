import { useState, useRef, useCallback, useEffect } from "react";
import type { FlyerRecord, LayoutMode } from "../types";

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

interface Position {
  x: number;
  y: number;
}

function getDefaultPosition(): Position {
  const panelWidth = 320;
  const fabRight = 24;
  const fabWidth = 52;
  const gap = 16;

  const x = window.innerWidth - fabRight - fabWidth - gap - panelWidth;
  const y = Math.max(20, (window.innerHeight - 450) / 2);

  return {
    x: Math.max(10, x),
    y: Math.max(10, y),
  };
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
  const [position, setPosition] = useState<Position>(() => getDefaultPosition());
  const [isDragging, setIsDragging] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isOpen) return;

    const savedPosition = localStorage.getItem("vgen-records-panel-position");
    if (savedPosition) {
      try {
        const parsed = JSON.parse(savedPosition);
        setPosition(parsed);
      } catch {
        setPosition(getDefaultPosition());
      }
    } else {
      setPosition(getDefaultPosition());
    }

    const savedPinned = localStorage.getItem("vgen-records-panel-pinned");
    if (savedPinned === "true") {
      setIsPinned(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isPinned) {
      localStorage.setItem("vgen-records-panel-position", JSON.stringify(position));
      localStorage.setItem("vgen-records-panel-pinned", "true");
    }
  }, [position, isPinned, isOpen]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button, input, .vgen-record-item, .vgen-search")) return;

      e.preventDefault();
      setIsDragging(true);
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      const maxX = window.innerWidth - 340;
      const maxY = window.innerHeight - 100;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handlePinToggle = () => {
    setIsPinned((prev) => {
      const newPinned = !prev;
      if (newPinned) {
        localStorage.setItem("vgen-records-panel-position", JSON.stringify(position));
        localStorage.setItem("vgen-records-panel-pinned", "true");
      } else {
        localStorage.removeItem("vgen-records-panel-position");
        localStorage.removeItem("vgen-records-panel-pinned");
      }
      return newPinned;
    });
  };

  const handleResetPosition = () => {
    setPosition(getDefaultPosition());
    localStorage.removeItem("vgen-records-panel-position");
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`vgen-floating-panel vgen-records-panel ${isDragging ? "dragging" : ""} ${isPinned ? "pinned" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="vgen-floating-panel-header" onMouseDown={handleMouseDown}>
        <div className="vgen-floating-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <span>Lotes ({records.length})</span>
        </div>
        <div className="vgen-floating-panel-actions">
          <button className="vgen-floating-panel-btn pin" onClick={handlePinToggle} title={isPinned ? "Desfijar posición" : "Fijar posición"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z" />
            </svg>
          </button>
          {!isPinned && (
            <button className="vgen-floating-panel-btn reset" onClick={handleResetPosition} title="Restablecer posición">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}
          <button className="vgen-floating-panel-btn close" onClick={onClose} title="Cerrar panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

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
                <button className="v-icon-btn" title="Descargar 2 por hoja" onClick={() => onExportSingle(record, "2-up")}>2↓</button>
                <button className="v-icon-btn" title="Descargar 3 por hoja" onClick={() => onExportSingle(record, "3-up")}>3↓</button>
                <button className="v-icon-btn danger" title="Eliminar" onClick={() => onDeleteRecord(record.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="vgen-floating-panel-drag-hint">
        {isDragging ? "Suelta para fijar" : "Arrastra para mover"}
      </div>
    </div>
  );
}
