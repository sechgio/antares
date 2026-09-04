import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface PreviewButtonProps {
  active: boolean;
  onToggle: () => void;
  compact?: boolean;
}

export default function PreviewButton({ active, onToggle, compact = false }: PreviewButtonProps) {
  const [hovered, setHovered] = useState(false);
  const showPause = active || hovered;

  return (
    <WithHoverTooltip label="Vista previa" placement="bottom" variant="dark">
      <button
        type="button"
        data-testid="canvas-preview-btn"
        aria-label="Vista previa"
        aria-pressed={active}
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={
          compact
            ? 'canvas-btn-primary canvas-btn-primary--icon canvas-preview-btn'
            : 'canvas-btn-primary canvas-preview-btn'
        }
      >
        <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <span
            aria-hidden={showPause}
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
              showPause ? 'scale-95 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-none'
            }`}
          >
            <Play className="h-3.5 w-3.5" />
          </span>
          <span
            aria-hidden={!showPause}
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
              showPause ? 'scale-100 opacity-100 blur-none' : 'scale-95 opacity-0 blur-[2px]'
            }`}
          >
            <Pause className="h-3.5 w-3.5" />
          </span>
        </span>
        {!compact ? 'Vista previa' : null}
      </button>
    </WithHoverTooltip>
  );
}