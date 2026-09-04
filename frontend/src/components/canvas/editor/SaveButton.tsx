import { useState } from 'react';
import { Check, Save } from 'lucide-react';

interface SaveButtonProps {
  onSave: () => void;
  dirty?: boolean;
}

export default function SaveButton({ onSave, dirty = false }: SaveButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      data-testid="canvas-save-btn"
      aria-label={dirty ? 'Guardar (hay cambios sin guardar)' : 'Guardar'}
      onClick={onSave}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="canvas-btn-primary"
    >
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span
          aria-hidden={hovered}
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
            hovered ? 'scale-95 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-none'
          }`}
        >
          <Save className="h-3.5 w-3.5" />
        </span>
        <span
          aria-hidden={!hovered}
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
            hovered ? 'scale-100 opacity-100 blur-none' : 'scale-95 opacity-0 blur-[2px]'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        {dirty && (
          <span
            data-testid="canvas-save-dirty"
            aria-hidden
            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-400"
          />
        )}
      </span>
      Guardar
    </button>
  );
}