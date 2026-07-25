import { FileStack } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { CANVAS_PRESETS } from '../presets';

interface TemplatesSectionProps {
  onApplyPreset: (presetId: string) => void;
  /** Tooltip side — left panel uses right; right panel uses left. */
  tooltipPlacement?: 'left' | 'right';
}

export default function TemplatesSection({
  onApplyPreset,
  tooltipPlacement = 'right',
}: TemplatesSectionProps) {
  return (
    <div data-testid="canvas-templates-section">
      <div className="canvas-section-title mb-1.5 px-1">Plantillas</div>
      <div>
        {CANVAS_PRESETS.map((p) => (
          <WithHoverTooltip
            key={p.id}
            label={`Aplicar «${p.label}»`}
            placement={tooltipPlacement}
            variant="dark"
            className="w-full"
          >
            <button
              type="button"
              onClick={() => onApplyPreset(p.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--cv-hover)]"
              style={{ color: 'var(--cv-text-secondary)' }}
              aria-label={`Aplicar plantilla ${p.label}`}
            >
              <FileStack className="h-3 w-3 shrink-0" />
              {p.label}
            </button>
          </WithHoverTooltip>
        ))}
      </div>
    </div>
  );
}
