import { exportLayerPng } from '../../../ops/exportPng';
import { layerPanelTitle } from '../../../ops/layerStyle';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function ExportSection({
  layer,
  exportScale,
  setExportScale,
  exporting,
  setExporting,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Exportar" />
      <div className="flex gap-2">
        <select
          className="canvas-input"
          value={exportScale}
          onChange={(e) => setExportScale(Number(e.target.value))}
          aria-label="Escala de exportación"
        >
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>
        <select className="canvas-input" value="png" disabled aria-label="Formato">
          <option value="png">PNG</option>
        </select>
      </div>
      <button
        type="button"
        className="canvas-export-btn"
        disabled={exporting}
        onClick={() => {
          setExporting(true);
          void exportLayerPng(layer.id, layer.name || layerPanelTitle(layer), exportScale).finally(
            () => setExporting(false),
          );
        }}
      >
        Exportar {layer.name || layerPanelTitle(layer)}
      </button>
    </div>
  );
}
