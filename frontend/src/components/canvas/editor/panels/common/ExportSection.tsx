import { Download } from 'lucide-react';
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
  const fileName = layer.name || layerPanelTitle(layer);
  return (
    <div className="canvas-section">
      <SectionHeader title="Exportar" />
      <div className="canvas-export-row">
        <CanvasSelect
          value={String(exportScale)}
          onChange={(val) => setExportScale(Number(val))}
          aria-label="Escala de exportación"
          options={[
            { value: '1', label: '1x' },
            { value: '2', label: '2x' },
          ]}
        />
        <span className="canvas-export-format">PNG</span>
        <button
          type="button"
          className="canvas-export-btn"
          disabled={exporting}
          aria-label={`Exportar ${fileName}`}
          onClick={() => {
            setExporting(true);
            void exportLayerPng(layer.id, fileName, exportScale).finally(() => setExporting(false));
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
