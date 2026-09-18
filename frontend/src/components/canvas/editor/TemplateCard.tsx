import { Layers, Plus } from 'lucide-react';
import { A4_HEIGHT_PX, type CanvasDocument } from '../types';
import type { PresetMeta } from '../presets/presetCategories';
import PageLayerPreview from './PageLayerPreview';
import Button from '@/components/ui/Button';

const THUMB_SCALE = 140 / A4_HEIGHT_PX;

interface TemplateCardProps {
  presetId: string;
  label: string;
  meta: PresetMeta;
  document: CanvasDocument;
  onInspect: () => void;
  onCreate: () => void;
  onApply: () => void;
}

export default function TemplateCard({
  presetId,
  label,
  meta,
  document,
  onInspect,
  onCreate,
  onApply,
}: TemplateCardProps) {
  return (
    <article className="tpl-card" data-preset={presetId}>
      <div className="tpl-thumb">
        <Button variant="none" size="none"
          className="tpl-thumb-hit"
          onClick={onInspect}
          aria-label={`Vista previa de ${label}`}
        />
        <div className="tpl-thumb-paper" aria-hidden="true">
          <PageLayerPreview document={document} scale={THUMB_SCALE} />
        </div>
        {meta.district ? <span className="tpl-badge">{meta.district}</span> : null}
        <div className="tpl-thumb-actions">
          <Button variant="none" size="none" className="tpl-action tpl-action--primary" onClick={onCreate}>
            <Plus className="h-3 w-3" />
            Crear
          </Button>
          <Button variant="none" size="none"
            className="tpl-action tpl-action--icon"
            onClick={onApply}
            aria-label={`Aplicar ${label} al lienzo actual`}
            title="Aplicar al lienzo actual"
          >
            <Layers className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="tpl-card-body">
        <h3 className="tpl-card-title">{label}</h3>
        <p className="tpl-card-sub">{meta.description}</p>
      </div>
    </article>
  );
}
