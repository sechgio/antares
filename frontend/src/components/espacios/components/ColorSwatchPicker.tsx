import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { ESPACIOS_COLORS, toColorInputValue } from '../utils/colors';
import Button from '@/components/ui/Button';

interface ColorSwatchPickerProps {
  color: string;
  label: string;
  onChange: (color: string) => void;
}

const PANEL_WIDTH = 148;
const PANEL_GAP = 6;

export default function ColorSwatchPicker({ color, label, onChange }: ColorSwatchPickerProps) {
  const {
    isOpen: open,
    position,
    triggerRef,
    popupRef: panelRef,
    close,
    toggle,
  } = useAnchoredPopover({
    estimatedHeight: 120,
    estimatedWidth: PANEL_WIDTH,
    gap: PANEL_GAP,
  });
  const panelId = useId();
  const safeColor = toColorInputValue(color);

  const selectColor = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div className="relative shrink-0">
      <WithHoverTooltip label={`Color de ${label}`} placement="right">
        <Button variant="none" size="none"
          ref={triggerRef}
          aria-label={`Cambiar color de ${label}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? panelId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
        >
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/15 shadow-sm"
            style={{ backgroundColor: safeColor }}
          />
        </Button>
      </WithHoverTooltip>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`Paleta de color para ${label}`}
            className="fixed z-[200] w-[148px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-xl"
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: -9999, left: -9999, visibility: 'hidden' }
            }
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-5 gap-1.5">
              {ESPACIOS_COLORS.map((preset) => {
                const selected = preset.toLowerCase() === safeColor.toLowerCase();
                return (
                  <Button variant="none" size="none"
                    key={preset}
                    aria-label={`Color ${preset}`}
                    aria-pressed={selected}
                    onClick={() => selectColor(preset)}
                    className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                      selected
                        ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-elevated)]'
                        : ''
                    }`}
                    style={{ backgroundColor: preset }}
                  />
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 py-1">
              <span
                className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: safeColor }}
              />
              <input
                type="color"
                value={safeColor}
                aria-label={`Color personalizado para ${label}`}
                onChange={(e) => onChange(e.target.value)}
                className="h-5 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
          </div>,
          document.body,
        )}
    </div>
  );
}
