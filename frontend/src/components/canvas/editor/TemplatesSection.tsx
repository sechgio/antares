import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FileStack, RotateCcw } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import {
  loadCanvasPresets,
  type CanvasPreset,
} from '../presets/loadPresets';
import { resetPresetLabel, resolvePresetLabels, setPresetLabel } from '../ops/presetLabels';

interface TemplatesSectionProps {
  onApplyPreset: (presetId: string) => void;
  onNewFromPreset?: (presetId: string, label: string) => void;
  tooltipPlacement?: 'left' | 'right';
}

export default function TemplatesSection({
  onApplyPreset,
  onNewFromPreset,
  tooltipPlacement = 'right',
}: TemplatesSectionProps) {
  const [presets, setPresets] = useState<ReadonlyArray<CanvasPreset> | null>(null);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const ensureLoaded = useCallback(() => {
    if (presets) return;
    void loadCanvasPresets().then((loaded) => {
      const resolved = resolvePresetLabels(loaded);
      setPresets(loaded);
      const custom: Record<string, string> = {};
      for (const r of resolved) {
        if (r.label !== loaded.find((p) => p.id === r.id)?.label) {
          custom[r.id] = r.label;
        }
      }
      setCustomLabels(custom);
    });
  }, [presets]);

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

  useEffect(() => {
    if (renamingId === null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  const startRename = useCallback((presetId: string, currentLabel: string) => {
    setRenameDraft(currentLabel);
    setRenamingId(presetId);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId === null) return;
    const id = renamingId;
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed) return;
    setPresetLabel(id, trimmed);
    setCustomLabels((prev) => ({ ...prev, [id]: trimmed }));
  }, [renamingId, renameDraft]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const suppressBlurCommitRef = useRef(false);

  const handleResetLabel = useCallback((presetId: string, originalLabel: string) => {
    resetPresetLabel(presetId);
    setCustomLabels((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
    if (renamingId === presetId) {
      setRenameDraft(originalLabel);
      setRenamingId(null);
    }
  }, [renamingId]);

  const labeledPresets = useMemo(() => {
    if (!presets) return null;
    return presets.map((p) => ({
      ...p,
      displayLabel: customLabels[p.id] ?? p.label,
      isCustom: Boolean(customLabels[p.id]),
    }));
  }, [presets, customLabels]);

  return (
    <div
      data-testid="canvas-templates-section"
      onMouseEnter={ensureLoaded}
      onFocusCapture={ensureLoaded}
    >
      <div className="canvas-section-title mb-1.5 px-1">Plantillas</div>
      <div>
        {!labeledPresets ? (
          <div className="px-2 py-1 text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
            Cargando plantillas…
          </div>
        ) : (
          labeledPresets.map((p) => (
            <div key={p.id} className="group relative flex items-center">
              {renamingId === p.id ? (
                <input
                  ref={renameInputRef}
                  className="canvas-input canvas-input--inline m-0.5 w-full text-[11px]"
                  value={renameDraft}
                  aria-label={`Renombrar plantilla ${p.label}`}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => {
                    if (suppressBlurCommitRef.current) {
                      suppressBlurCommitRef.current = false;
                      return;
                    }
                    commitRename();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      suppressBlurCommitRef.current = true;
                      commitRename();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      suppressBlurCommitRef.current = true;
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <>
                  <WithHoverTooltip
                    label={`Aplicar «${p.displayLabel}»`}
                    placement={tooltipPlacement}
                    variant="dark"
                    className="flex-1 min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => onApplyPreset(p.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(p.id, p.displayLabel);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--cv-hover)]"
                      style={{ color: 'var(--cv-text-secondary)' }}
                      aria-label={`Aplicar plantilla ${p.label}`}
                    >
                      <FileStack className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{p.displayLabel}</span>
                    </button>
                  </WithHoverTooltip>
                  {onNewFromPreset && (
                    <WithHoverTooltip
                      label={`Crear documento con «${p.displayLabel}»`}
                      placement={tooltipPlacement}
                      variant="dark"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onNewFromPreset(p.id, p.displayLabel);
                        }}
                        className={`canvas-icon-btn absolute top-1/2 -translate-y-1/2 !h-5 !w-5 opacity-30 transition-opacity hover:opacity-100 ${p.isCustom ? 'right-6' : 'right-0.5'}`}
                        aria-label={`Crear documento con plantilla ${p.label}`}
                        data-testid={`canvas-new-from-preset-${p.id}`}
                      >
                        <FilePlus2 className="h-3 w-3" />
                      </button>
                    </WithHoverTooltip>
                  )}
                  {p.isCustom && (
                    <WithHoverTooltip
                      label="Restaurar nombre original"
                      placement={tooltipPlacement}
                      variant="dark"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResetLabel(p.id, p.label);
                        }}
                        className="canvas-icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 !h-5 !w-5 opacity-30 transition-opacity hover:opacity-100"
                        aria-label={`Restaurar nombre original de ${p.label}`}
                        data-testid={`canvas-reset-preset-${p.id}`}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </WithHoverTooltip>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
