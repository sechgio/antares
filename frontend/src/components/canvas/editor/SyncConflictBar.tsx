import { useEffect } from 'react';
import { CloudOff } from 'lucide-react';
import type { SyncConflict } from '../sync/canvasCloudSync';
import type { SyncConflictChoice } from '../hooks/useCanvasSync';

interface SyncConflictBarProps {
  conflict: SyncConflict;
  onResolve: (choice: SyncConflictChoice) => void;
}

export default function SyncConflictBar({ conflict, onResolve }: SyncConflictBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onResolve('keep-local');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onResolve]);

  const docName = conflict.remoteDoc.name || conflict.localDoc.name || 'documento';

  return (
    <div
      className="canvas-sync-conflict-bar"
      data-testid="sync-conflict-bar"
      role="status"
      aria-live="polite"
    >
      <CloudOff size={14} strokeWidth={2} className="canvas-sync-conflict-bar__icon" aria-hidden />
      <p className="canvas-sync-conflict-bar__text">
        Versión más nueva en la nube
        <span className="canvas-sync-conflict-bar__name"> · {docName}</span>
      </p>
      <div className="canvas-sync-conflict-bar__actions">
        <button
          type="button"
          data-testid="sync-conflict-keep-local"
          className="canvas-sync-conflict-bar__btn"
          onClick={() => onResolve('keep-local')}
        >
          Mantener
        </button>
        <button
          type="button"
          data-testid="sync-conflict-use-remote"
          className="canvas-sync-conflict-bar__btn canvas-sync-conflict-bar__btn--primary"
          onClick={() => onResolve('use-remote')}
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
