import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface PreviewButtonProps {
  active: boolean;
  onToggle: () => void;
}

export default function PreviewButton({ active, onToggle }: PreviewButtonProps) {
  const [hovered, setHovered] = useState(false);
  const showPause = active || hovered;

  return (
    <WithHoverTooltip label="Vista previa" placement="bottom" variant="dark">
      <motion.button
        type="button"
        data-testid="canvas-preview-btn"
        aria-label="Vista previa"
        aria-pressed={active}
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.96 }}
        className="canvas-btn-primary canvas-preview-btn"
      >
        <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            {!showPause ? (
              <motion.span
                key="play"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 25 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Play className="h-3.5 w-3.5" />
              </motion.span>
            ) : (
              <motion.span
                key="pause"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 25 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Pause className="h-3.5 w-3.5" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        Vista previa
      </motion.button>
    </WithHoverTooltip>
  );
}
