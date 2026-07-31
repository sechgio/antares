import { useCallback, useEffect, useState } from 'react';
import { FileStack } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import {
  loadCanvasPresets,
  type CanvasPreset,
} from '../presets/loadPresets';

interface TemplatesSectionProps {
  onApplyPreset: (presetId: string) => void;
  /** Tooltip side — left panel uses right; right panel uses left. */
  tooltipPlacement?: 'left' | 'right';
}

export default function TemplatesSection({
  onApplyPreset,
  tooltipPlacement = 'right',
}: TemplatesSectionProps) {
  const [presets, setPresets] = useState<ReadonlyArray<CanvasPreset> | null>(null);

  const ensureLoaded = useCallback(() => {
    if (presets) return;
    void loadCanvasPresets().then(setPresets);
  }, [presets]);

  // Soft prefetch after paint so the list appears without blocking CanvasView evaluate.
  // Skip in Vitest — pending dynamic imports after environment teardown are noisy false failures.
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const ric = window.requestIdleCallback?.bind(window);
    if (ric) {
      const id = ric(() => ensureLoaded(), { timeout: 1500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(ensureLoaded, 1);
    return () => window.clearTimeout(t);
  }, [ensureLoaded]);

  return (
    <div
      data-testid="canvas-templates-section"
      onMouseEnter={ensureLoaded}
      onFocusCapture={ensureLoaded}
    >
      <div className="canvas-section-title mb-1.5 px-1">Plantillas</div>
      <div>
        {!presets ? (
          <div className="px-2 py-1 text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
            Cargando plantillas…
          </div>
        ) : (
          presets.map((p) => (
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
          ))
        )}
      </div>
    </div>
  );
}
