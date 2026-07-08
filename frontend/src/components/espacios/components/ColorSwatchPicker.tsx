import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ESPACIOS_COLORS, toColorInputValue } from '../utils/colors';

interface ColorSwatchPickerProps {
  color: string;
  label: string;
  onChange: (color: string) => void;
}

const PANEL_WIDTH = 148;
const PANEL_GAP = 6;

interface PanelPosition {
  top: number;
  left: number;
}

export default function ColorSwatchPicker({ color, label, onChange }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const safeColor = toColorInputValue(color);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 120;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < panelHeight + PANEL_GAP && rect.top > spaceBelow;

    let left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - PANEL_WIDTH - 8));

    const top = openUp
      ? Math.max(8, rect.top - panelHeight - PANEL_GAP)
      : Math.min(rect.bottom + PANEL_GAP, window.innerHeight - panelHeight - 8);

    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleLayout = () => updatePosition();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleLayout);
    window.addEventListener('scroll', handleLayout, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleLayout);
      window.removeEventListener('scroll', handleLayout, true);
    };
  }, [open, updatePosition]);

  const selectColor = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Cambiar color de ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title={`Color de ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-black/15 shadow-sm"
          style={{ backgroundColor: safeColor }}
        />
      </button>

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
                  <button
                    key={preset}
                    type="button"
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
