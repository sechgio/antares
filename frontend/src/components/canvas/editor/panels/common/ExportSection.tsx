import { exportLayerPng } from '../../../ops/exportPng';
import { layerPanelTitle } from '../../../ops/layerStyle';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

import CanvasSelect from '../../CanvasSelect';

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
        <CanvasSelect
          value={String(exportScale)}
          onChange={(val) => setExportScale(Number(val))}
          aria-label="Escala de exportación"
          options={[
            { value: '1', label: '1x' },
            { value: '2', label: '2x' },
          ]}
        />
        <CanvasSelect
          value="png"
          onChange={() => {}}
          disabled
          aria-label="Formato"
          options={[{ value: 'png', label: 'PNG' }]}
        />
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
