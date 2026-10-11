import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportLayerPng } from '../../../ops/exportPng';
import { layerPanelTitle } from '../../../ops/layerStyle';
import { errorMessage } from '@/utils/errors';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

import CanvasSelect from '../../CanvasSelect';
import Button from '@/components/ui/Button';

export default function ExportSection({
  layer,
  exportScale,
  setExportScale,
  exporting,
  setExporting,
}: SectionProps) {
  const fileName = layer.name || layerPanelTitle(layer);
  const [error, setError] = useState<string | null>(null);
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
        <Button variant="none" size="none"
          className="canvas-export-btn"
          disabled={exporting}
          aria-label={`Exportar ${fileName}`}
          onClick={() => {
            setError(null);
            setExporting(true);
            void exportLayerPng(layer.id, fileName, exportScale)
              .catch((err: unknown) => setError(errorMessage(err, 'No se pudo exportar el PNG')))
              .finally(() => setExporting(false));
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="canvas-export-error mt-1 text-[10px] text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
