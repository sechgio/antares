import { useEffect, useRef } from 'react';
import { CloudOff } from 'lucide-react';
import type { SyncConflict } from '../sync/canvasCloudSync';
import type { SyncConflictChoice } from '../hooks/useCanvasSync';

interface SyncConflictModalProps {
  conflict: SyncConflict;
  onResolve: (choice: SyncConflictChoice) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SyncConflictModal({ conflict, onResolve }: SyncConflictModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

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
      ref={overlayRef}
      data-testid="sync-conflict-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg-base) 88%, transparent)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onResolve('keep-local');
      }}
    >
      <div
        data-testid="sync-conflict-dialog"
        className="w-full max-w-[30rem] rounded-xl p-5 animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: '1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-subtle))',
          boxShadow:
            '0 0 0 1px color-mix(in srgb, var(--accent-primary) 18%, transparent), 0 24px 64px color-mix(in srgb, var(--bg-base) 70%, transparent)',
        }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
      >
        {/* Header */}
        <div className="mb-4 flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)',
              backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, var(--bg-surface))',
            }}
          >
            <CloudOff size={20} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3
              id="sync-conflict-title"
              className="text-[16px] font-semibold leading-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Conflicto de sincronización
            </h3>
            <p className="mt-1.5 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              Otro dispositivo editó «{docName}» mientras tenías cambios sin guardar.
            </p>
          </div>
        </div>

        {/* Timestamp comparison */}
        <div
          className="mb-5 flex gap-3 rounded-lg p-3 text-[12px]"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex-1">
            <div className="mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Tu versión local
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              {conflict.localUpdatedAt ? formatTime(conflict.localUpdatedAt) : '—'}
            </div>
          </div>
          <div
            className="w-px self-stretch"
            style={{ backgroundColor: 'var(--border-subtle)' }}
          />
          <div className="flex-1">
            <div className="mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Versión en la nube
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              {conflict.remoteUpdatedAt ? formatTime(conflict.remoteUpdatedAt) : '—'}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="sync-conflict-keep-local"
            onClick={() => onResolve('keep-local')}
            className="rounded-md px-4 py-2 text-[13px] font-medium transition-colors"
            style={{
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-medium)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-medium)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            Mantener mis cambios
          </button>
          <button
            type="button"
            data-testid="sync-conflict-use-remote"
            onClick={() => onResolve('use-remote')}
            className="rounded-md px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              color: 'var(--text-on-accent)',
              backgroundColor: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary-hover)',
            }}
          >
            Usar versión en la nube
          </button>
        </div>
      </div>
    </div>
  );
}
