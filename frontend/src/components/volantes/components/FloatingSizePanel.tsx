import { useEffect, useState } from "react";
import type { FlyerRecord, LayoutMode } from "../types";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";
import { useFloatingPanel } from "../hooks/useFloatingPanel";

interface FloatingSizePanelProps {
  selectedRecord: FlyerRecord | null;
  layoutMode: LayoutMode;
  onUpdateRecord: (patch: Partial<Omit<FlyerRecord, "id">>) => void;
  isOpen: boolean;
  onClose: () => void;
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

export default function FloatingSizePanel({
  selectedRecord,
  layoutMode,
  onUpdateRecord,
  isOpen,
  onClose,
}: FloatingSizePanelProps) {
  const [activeTab, setActiveTab] = useState<LayoutMode>(layoutMode);
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
    panelWidth: 300,
    storageKeyPosition: "vgen-floating-panel-position",
    storageKeyPinned: "vgen-floating-panel-pinned",
    ignoreSelector: "button, input, .vgen-range-item",
  });

  useEffect(() => {
    setActiveTab(layoutMode);
  }, [layoutMode]);

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
          <WithHoverTooltip label={isPinned ? "Desfijar posición" : "Fijar posición"} placement="bottom">
            <button
              className="vgen-floating-panel-btn pin"
              onClick={handlePinToggle}
              aria-label={isPinned ? "Desfijar posición" : "Fijar posición"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z" />
              </svg>
            </button>
          </WithHoverTooltip>
          {!isPinned && (
            <WithHoverTooltip label="Restablecer posición" placement="bottom">
              <button
                className="vgen-floating-panel-btn reset"
                onClick={handleResetPosition}
                aria-label="Restablecer posición"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </WithHoverTooltip>
          )}
          <WithHoverTooltip label="Cerrar panel" placement="bottom">
            <button
              className="vgen-floating-panel-btn close"
              onClick={onClose}
              aria-label="Cerrar panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </WithHoverTooltip>
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
