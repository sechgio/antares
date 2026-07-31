import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Save } from 'lucide-react';

interface SaveButtonProps {
  onSave: () => void;
}

export default function SaveButton({ onSave }: SaveButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      data-testid="canvas-save-btn"
      aria-label="Guardar"
      onClick={onSave}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="canvas-btn-primary"
    >
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {!hovered ? (
            <motion.span
              key="save"
              initial={{ scale: 0.95, opacity: 0, filter: 'blur(2px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              exit={{ scale: 0.95, opacity: 0, filter: 'blur(2px)' }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Save className="h-3.5 w-3.5" />
            </motion.span>
          ) : (
            <motion.span
              key="check"
              initial={{ scale: 0.95, opacity: 0, filter: 'blur(2px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              exit={{ scale: 0.95, opacity: 0, filter: 'blur(2px)' }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      Guardar
    </motion.button>
  );
}
