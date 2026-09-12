import { useEffect, useState } from "react";
import type { FlyerRecord, LayoutMode } from "../types";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import FloatingPanelFrame from "./FloatingPanelFrame";

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
    <FloatingPanelFrame
      panelRef={panelRef}
      position={position}
      isDragging={isDragging}
      isPinned={isPinned}
      onMouseDown={handleMouseDown}
      onPinToggle={handlePinToggle}
      onResetPosition={handleResetPosition}
      onClose={onClose}
      title={(
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20h16" />
            <path d="M4 12h16" />
            <path d="M4 4h16" />
          </svg>
          <span>Tamaño de textos</span>
        </>
      )}
    >
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

    </FloatingPanelFrame>
  );
}
