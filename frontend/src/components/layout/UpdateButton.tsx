import { useState, useEffect, useCallback } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

interface UpdateData {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  message?: string;
}

export default function UpdateButton() {
  const [update, setUpdate] = useState<UpdateData>({
    status: 'idle',
    version: null,
    progress: 0,
  });

  useEffect(() => {
    if (!window.electronAPI?.onAutoUpdateStatus) return;

    const cleanup = window.electronAPI.onAutoUpdateStatus((data) => {
      setUpdate(data as UpdateData);
    });

    return cleanup;
  }, []);

  const handleCheck = useCallback(async () => {
    if (!window.electronAPI?.autoUpdateCheck) return;
    setUpdate({ status: 'checking', version: null, progress: 0 });
    try {
      await window.electronAPI.autoUpdateCheck();
    } catch (err) {
      setUpdate({ status: 'error', version: null, progress: 0, message: String(err) });
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI?.autoUpdateInstall) return;
    try {
      await window.electronAPI.autoUpdateInstall();
    } catch (err) {
      setUpdate({ status: 'error', version: null, progress: 0, message: String(err) });
    }
  }, []);

  const handleClick = useCallback(() => {
    if (update.status === 'ready') {
      handleInstall();
    } else if (update.status === 'idle' || update.status === 'up-to-date' || update.status === 'error') {
      handleCheck();
    }
  }, [update.status, handleInstall, handleCheck]);

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  if (!isElectron) return null;

  const isActive = update.status === 'checking' || update.status === 'downloading';
  const hasUpdate = update.status === 'available' || update.status === 'downloading' || update.status === 'ready';
  const isError = update.status === 'error';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        className={`app-titlebar-button flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${isActive ? 'pointer-events-none opacity-70' : ''} ${hasUpdate ? 'text-[var(--accent-blue)]' : ''} ${isError ? 'text-[var(--accent-red)]' : ''}`}
        disabled={isActive}
        title={
          update.status === 'checking' ? 'Buscando actualización...' :
          update.status === 'downloading' ? `Descargando ${update.version}... ${update.progress}%` :
          update.status === 'ready' ? `${update.version} lista. Clic para instalar.` :
          update.status === 'error' ? 'Error al actualizar' :
          update.status === 'up-to-date' ? 'Estás en la última versión' :
          'Buscar actualización'
        }
      >
        {update.status === 'checking' && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
        {update.status === 'downloading' && <Download size={14} strokeWidth={1.8} />}
        {update.status === 'ready' && <CheckCircle size={14} strokeWidth={1.8} />}
        {update.status === 'error' && <AlertCircle size={14} strokeWidth={1.8} />}
        {(update.status === 'idle' || update.status === 'up-to-date') && <Download size={14} strokeWidth={1.8} />}
        {hasUpdate && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
        )}
      </button>

      {update.status === 'downloading' && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] shadow-lg">
            {update.progress}%
          </div>
        </div>
      )}

      {update.status === 'ready' && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2">
          <button
            onClick={handleInstall}
            className="whitespace-nowrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-primary)] shadow-lg transition-colors hover:bg-[var(--bg-hover)]"
          >
            Instalar {update.version}
          </button>
        </div>
      )}
    </div>
  );
}
