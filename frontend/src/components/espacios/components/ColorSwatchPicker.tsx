import { useEffect, useId, useRef, useState } from 'react';
import { ESPACIOS_COLORS } from '../utils/colors';

interface ColorSwatchPickerProps {
  color: string;
  label: string;
  onChange: (color: string) => void;
}

export default function ColorSwatchPicker({ color, label, onChange }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Cambiar color de ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        title={`Color de ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
      >
        <span
          className="h-3 w-3 rounded-full border border-black/10"
          style={{ backgroundColor: color }}
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Paleta de color para ${label}`}
          className="absolute left-0 top-full z-50 mt-1.5 w-[148px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-5 gap-1.5">
            {ESPACIOS_COLORS.map((preset) => {
              const selected = preset.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={preset}
                  type="button"
                  aria-label={`Color ${preset}`}
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(preset);
                    setOpen(false);
                  }}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                    selected ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-elevated)]' : ''
                  }`}
                  style={{ backgroundColor: preset }}
                />
              );
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 py-1">
            <span
              className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: color }}
            />
            <input
              type="color"
              value={color}
              aria-label={`Color personalizado para ${label}`}
              onChange={(e) => onChange(e.target.value)}
              className="h-5 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>
      )}
    </div>
  );
}