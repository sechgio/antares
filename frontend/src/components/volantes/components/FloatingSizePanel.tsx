import { useState, useRef, useCallback, useEffect } from "react";
import type { FlyerRecord, LayoutMode } from "../types";

interface FloatingSizePanelProps {
  selectedRecord: FlyerRecord | null;
  layoutMode: LayoutMode;
  onUpdateRecord: (patch: Partial<Omit<FlyerRecord, "id">>) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface Position {
  x: number;
  y: number;
}

const SIZE_FIELDS_2UP: Array<{
  key: keyof FlyerRecord;
  label: string;
}> = [
  { key: "titleSize2up", label: "Título" },
  { key: "districtSize2up", label: "Distrito" },
  { key: "serviceSize2up", label: "Interrupción" },
  { key: "headingsSize2up", label: "Encabezados" },
  { key: "reservoirSize2up", label: "Reservorio" },
  { key: "sectorSize2up", label: "Sector" },
  { key: "zonesFontSize2up", label: "Contenido zonas" },
];

const SIZE_FIELDS_3UP: Array<{
  key: keyof FlyerRecord;
  label: string;
}> = [
  { key: "titleSize3up", label: "Título" },
  { key: "districtSize3up", label: "Distrito" },
  { key: "serviceSize3up", label: "Interrupción" },
  { key: "headingsSize3up", label: "Encabezados" },
  { key: "reservoirSize3up", label: "Reservorio" },
  { key: "sectorSize3up", label: "Sector" },
  { key: "zonesFontSize3up", label: "Contenido zonas" },
];

function getDefaultPosition(): Position {
  const panelWidth = 300;
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

export default function FloatingSizePanel({
  selectedRecord,
  layoutMode,
  onUpdateRecord,
  isOpen,
  onClose,
}: FloatingSizePanelProps) {
  const [position, setPosition] = useState<Position>(() => getDefaultPosition());
  const [isDragging, setIsDragging] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<LayoutMode>(layoutMode);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    if (!isOpen) return;

    const savedPosition = localStorage.getItem("vgen-floating-panel-position");
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

    const savedPinned = localStorage.getItem("vgen-floating-panel-pinned");
    if (savedPinned === "true") {
      setIsPinned(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isPinned) {
      localStorage.setItem("vgen-floating-panel-position", JSON.stringify(position));
      localStorage.setItem("vgen-floating-panel-pinned", "true");
    }
  }, [position, isPinned, isOpen]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button, input, .vgen-range-item")) return;

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

      const maxX = window.innerWidth - 320;
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
        localStorage.setItem("vgen-floating-panel-position", JSON.stringify(position));
        localStorage.setItem("vgen-floating-panel-pinned", "true");
      } else {
        localStorage.removeItem("vgen-floating-panel-position");
        localStorage.removeItem("vgen-floating-panel-pinned");
      }
      return newPinned;
    });
  };

  const handleResetPosition = () => {
    setPosition(getDefaultPosition());
    localStorage.removeItem("vgen-floating-panel-position");
  };

  const renderSlider = (
    label: string,
    value: number | undefined,
    onChange: (v: number) => void
  ) => (
    <div className="vgen-range-item">
      <div className="vgen-range-header">
        <span className="vgen-range-layout-label">{label}</span>
        <span className="vgen-range-value">{value ?? 100}%</span>
      </div>
      <div className="vgen-range-row">
        <span className="vgen-range-label">A</span>
        <input
          className="vgen-range"
          type="range"
          min={50}
          max={150}
          step={1}
          value={value ?? 100}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="vgen-range-label lg">A</span>
      </div>
    </div>
  );

  if (!isOpen || !selectedRecord) return null;

  const currentFields = activeTab === "2-up" ? SIZE_FIELDS_2UP : SIZE_FIELDS_3UP;

  return (
    <div
      ref={panelRef}
      className={`vgen-floating-panel ${isDragging ? "dragging" : ""} ${isPinned ? "pinned" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="vgen-floating-panel-header" onMouseDown={handleMouseDown}>
        <div className="vgen-floating-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20h16" />
            <path d="M4 12h16" />
            <path d="M4 4h16" />
          </svg>
          <span>Tamaño de textos</span>
        </div>
        <div className="vgen-floating-panel-actions">
          <button
            className="vgen-floating-panel-btn pin"
            onClick={handlePinToggle}
            title={isPinned ? "Desfijar posición" : "Fijar posición"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z" />
            </svg>
          </button>
          {!isPinned && (
            <button
              className="vgen-floating-panel-btn reset"
              onClick={handleResetPosition}
              title="Restablecer posición"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}
          <button
            className="vgen-floating-panel-btn close"
            onClick={onClose}
            title="Cerrar panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="vgen-floating-panel-tabs">
        <button className={activeTab === "2-up" ? "active" : ""} onClick={() => setActiveTab("2-up")}>
          2 por hoja
        </button>
        <button className={activeTab === "3-up" ? "active" : ""} onClick={() => setActiveTab("3-up")}>
          3 por hoja
        </button>
      </div>

      <div className="vgen-floating-panel-content">
        <div className="vgen-range-block">
          <div className="vgen-range-block-title">
            {activeTab === "2-up" ? "2 por hoja" : "3 por hoja"}
          </div>
          {currentFields.map(({ key, label }) =>
            renderSlider(label, selectedRecord[key] as number | undefined, (v) =>
              onUpdateRecord({ [key]: v })
            )
          )}
        </div>
      </div>

      <div className="vgen-floating-panel-drag-hint">
        {isDragging ? "Suelta para fijar" : "Arrastra para mover"}
      </div>
    </div>
  );
}
