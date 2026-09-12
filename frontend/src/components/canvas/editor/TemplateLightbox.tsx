import { X } from 'lucide-react';
import type { CanvasDocument } from '../types';
import { PRESET_CATEGORY_LABELS, type PresetMeta } from '../presets/presetCategories';
import PageLayerPreview from './PageLayerPreview';

const LIGHTBOX_SCALE = 0.34;

interface TemplateLightboxProps {
  label: string;
  meta: PresetMeta;
  document: CanvasDocument;
  onClose: () => void;
  onCreate: () => void;
  onApply: () => void;
}

export default function TemplateLightbox({
  label,
  meta,
  document,
  onClose,
  onCreate,
  onApply,
}: TemplateLightboxProps) {
  return (
    <div
      className="tpl-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa de ${label}`}
    >
      <div className="tpl-lightbox-card">
        <div className="tpl-lightbox-stage" aria-hidden="true">
          <PageLayerPreview document={document} scale={LIGHTBOX_SCALE} />
        </div>
        <div className="tpl-lightbox-info">
          <span className="tpl-lightbox-cat">{PRESET_CATEGORY_LABELS[meta.category]}</span>
          <h3 className="tpl-lightbox-title">{label}</h3>
          <p className="tpl-lightbox-desc">{meta.description}</p>
          <dl className="tpl-spec">
            <div className="tpl-spec-row">
              <dt>Formato</dt>
              <dd>A4 vertical</dd>
            </div>
            <div className="tpl-spec-row">
              <dt>Estructura</dt>
              <dd>{meta.layout}</dd>
            </div>
            <div className="tpl-spec-row">
              <dt>Zona</dt>
              <dd>{meta.district ?? 'Todas'}</dd>
            </div>
          </dl>
          <div className="tpl-lightbox-actions">
            <button type="button" className="canvas-btn-primary" onClick={onCreate}>
              Crear documento
            </button>
            <button type="button" className="canvas-btn-ghost" onClick={onApply}>
              Aplicar al lienzo actual
            </button>
          </div>
        </div>
        <button
          type="button"
          className="canvas-icon-btn tpl-lightbox-close"
          onClick={onClose}
          aria-label="Cerrar vista previa"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
