import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

interface UpdateData {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  message?: string;
}

export default function UpdateButton() {
  const dialog = useDialog();
  const promptedReadyKeyRef = useRef<string | null>(null);
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
      const res = await window.electronAPI.autoUpdateCheck();
      if (res && !res.success) {
        setUpdate({ status: 'error', version: null, progress: 0, message: res.reason });
      }
    } catch (err) {
      setUpdate({ status: 'error', version: null, progress: 0, message: String(err) });
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI?.autoUpdateInstall) return;
    try {
      const res = await window.electronAPI.autoUpdateInstall();
      if (res && !res.success) {
        setUpdate({ status: 'error', version: null, progress: 0, message: res.reason });
      }
    } catch (err) {
      setUpdate({ status: 'error', version: null, progress: 0, message: String(err) });
    }
  }, []);

  const promptInstall = useCallback(async () => {
    const versionLabel = update.version ? `ANTARES ${update.version}` : 'la nueva versión de ANTARES';
    const confirmed = await dialog.confirm({
      title: 'Actualización lista',
      description: `${versionLabel} ya se descargó. Si instalas ahora, ANTARES se cerrará y volverá a abrirse automáticamente con la nueva versión.`,
      confirmLabel: 'Reiniciar e instalar',
      cancelLabel: 'Más tarde',
    });

    if (confirmed) {
      await handleInstall();
    }
  }, [dialog, handleInstall, update.version]);

  useEffect(() => {
    if (update.status !== 'ready') return;

    const readyKey = update.version || 'ready';
    if (promptedReadyKeyRef.current === readyKey) return;

    promptedReadyKeyRef.current = readyKey;
    void promptInstall();
  }, [promptInstall, update.status, update.version]);

  const handleClick = useCallback(() => {
    if (update.status === 'ready') {
      void promptInstall();
    } else if (update.status === 'idle' || update.status === 'up-to-date' || update.status === 'error') {
      handleCheck();
    }
  }, [update.status, promptInstall, handleCheck]);

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  if (!isElectron) return null;

  const isActive = update.status === 'checking' || update.status === 'downloading';
  const hasUpdate = update.status === 'available' || update.status === 'downloading' || update.status === 'ready';
  const isError = update.status === 'error';
  const iconWrapClass = hasUpdate
    ? 'flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] transition-colors group-hover:bg-[var(--accent-primary-hover)]'
    : 'flex h-5 w-5 items-center justify-center';
  const title =
    update.status === 'checking' ? 'Buscando actualización...' :
    update.status === 'available' ? 'Actualización disponible' :
    update.status === 'downloading' ? `Descargando ${update.version}... ${update.progress}%` :
    update.status === 'ready' ? `${update.version} lista. Clic para instalar.` :
    update.status === 'error' ? `Error al actualizar: ${update.message || 'Error desconocido'}` :
    update.status === 'up-to-date' ? 'Estás en la última versión' :
    'Buscar actualización';
  const ariaLabel =
    update.status === 'available' ? 'Actualización disponible' :
    update.status === 'downloading' ? 'Descargando actualización' :
    update.status === 'ready' ? 'Actualización lista para instalar' :
    title;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        className={`app-titlebar-button group flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${isActive ? 'pointer-events-none opacity-70' : ''} ${isError ? 'text-[var(--accent-red)]' : ''}`}
        disabled={isActive}
        title={title}
        aria-label={ariaLabel}
      >
        <span className={iconWrapClass} data-testid={hasUpdate ? 'update-status-badge' : undefined}>
          {update.status === 'checking' && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {(update.status === 'available' || update.status === 'downloading') && <Download size={14} strokeWidth={1.8} />}
          {update.status === 'ready' && <CheckCircle size={14} strokeWidth={1.8} />}
          {update.status === 'error' && <AlertCircle size={14} strokeWidth={1.8} />}
          {(update.status === 'idle' || update.status === 'up-to-date') && <Download size={14} strokeWidth={1.8} />}
        </span>
      </button>

      {update.status === 'downloading' && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] shadow-lg">
            {update.progress}%
          </div>
        </div>
      )}

    </div>
  );
}
