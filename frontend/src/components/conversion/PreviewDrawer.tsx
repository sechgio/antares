import { motion } from 'framer-motion';
import ImagePreview from '../ImagePreview';

interface PreviewDrawerProps {
  path: string | null;
  formato: string;
  calidad: number;
  resizeAncho: string;
  resizeAlto: string;
  onClose: () => void;
}

export default function PreviewDrawer({ path, formato, calidad, resizeAncho, resizeAlto, onClose }: PreviewDrawerProps) {
  if (!path) return null;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="fixed right-0 top-0 bottom-0 w-80 bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] z-40 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">Vista previa</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        <ImagePreview
          path={path}
          formato={formato}
          calidad={calidad}
          resizeAncho={resizeAncho}
          resizeAlto={resizeAlto}
        />
      </div>
    </motion.div>
  );
}
