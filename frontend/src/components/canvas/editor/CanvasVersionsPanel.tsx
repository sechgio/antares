import { memo, useEffect, useState } from 'react';
import { History, RotateCcw, RefreshCw, AlertCircle, Clock, User } from 'lucide-react';
import type { CanvasDocument } from '../types';

type CanvasVersionEntry = {
  id: string;
  created_at: string;
  created_by: string | null;
  label?: string | null;
};

interface CanvasVersionsPanelProps {
  documentId: string;
  onVersionRestored?: (doc: CanvasDocument) => void;
}

export default memo(function CanvasVersionsPanel({
  documentId,
  onVersionRestored,
}: CanvasVersionsPanelProps) {
  const [versions, setVersions] = useState<CanvasVersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const loadVersions = async () => {
    setLoading(true);
    setError(null);
    try {
      const { listCanvasVersions } = await import('../sync/canvasCloudSync');
      const data = await listCanvasVersions(documentId);
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar versiones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) {
      void loadVersions();
    }
  }, [documentId]);

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      const { restoreCanvasVersion } = await import('../sync/canvasCloudSync');
      const restored = await restoreCanvasVersion(documentId, versionId);
      if (restored) {
        setConfirmId(null);
        void loadVersions();
        onVersionRestored?.(restored);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al restaurar versión');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--cv-bg-panel)] text-[var(--cv-text)] text-xs">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--cv-border)] font-semibold text-[13px]">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--cv-accent)]" />
          <span>Historial de Versiones</span>
        </div>
        <button
          type="button"
          onClick={() => void loadVersions()}
          className="p-1 rounded hover:bg-[var(--cv-bg-hover)] text-[var(--cv-text-muted)]"
          title="Actualizar versiones"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-[var(--cv-text-muted)] space-y-2">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--cv-accent)]" />
            <span>Cargando versiones...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 rounded bg-red-950/30 text-red-400 border border-red-900/40">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="p-4 text-center text-[var(--cv-text-muted)]">
            No hay versiones anteriores guardadas para este documento.
          </div>
        ) : (
          versions.map((ver, idx) => {
            const isLatest = idx === 0;
            const isConfirming = confirmId === ver.id;
            const isRestoring = restoringId === ver.id;
            const dateStr = new Date(ver.created_at).toLocaleString('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={ver.id}
                className="p-2.5 rounded border border-[var(--cv-border)] bg-[var(--cv-bg-card)] hover:border-[var(--cv-border-focus)] transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-[11px] text-[var(--cv-text)]">
                    <Clock className="h-3 w-3 text-[var(--cv-text-muted)]" />
                    <span>{dateStr}</span>
                  </div>
                  {isLatest ? (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-950/50 rounded border border-emerald-800/40">
                      Actual
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--cv-text-muted)]">
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    <span className="truncate max-w-[120px]">
                      {ver.created_by ? `Usuario (${ver.created_by.slice(0, 8)})` : 'Sistema'}
                    </span>
                  </div>

                  {!isLatest && (
                    <div>
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isRestoring}
                            onClick={() => void handleRestore(ver.id)}
                            className="px-2 py-0.5 bg-amber-600 text-white rounded font-medium text-[10px] hover:bg-amber-500"
                          >
                            {isRestoring ? 'Restaurando...' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="px-1.5 py-0.5 bg-[var(--cv-bg-hover)] text-[var(--cv-text-muted)] rounded text-[10px]"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(ver.id)}
                          className="flex items-center gap-1 px-2 py-1 bg-[var(--cv-bg-hover)] hover:bg-[var(--cv-accent)] hover:text-white rounded transition-colors text-[10px] font-medium"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Restaurar</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
