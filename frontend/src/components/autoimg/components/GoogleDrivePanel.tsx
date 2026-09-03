import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, HardDrive, Loader2, Plus } from 'lucide-react';
import { api } from '../../../api';
import type { AutoImgFolder, DriveVerifyResult } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { INPUT_SM_CLASS, InlineMessage, SidebarSection, StatusChip } from './shared';

interface GoogleDrivePanelProps {
  googleConnected: boolean;
  onFolderAdded?: (folders?: AutoImgFolder[]) => void | Promise<void>;
}

export default function GoogleDrivePanel({ googleConnected, onFolderAdded }: GoogleDrivePanelProps) {
  const [driveConnected, setDriveConnected] = useState(false);
  const [folderInput, setFolderInput] = useState('');
  const [folderName, setFolderName] = useState('');
  const [verified, setVerified] = useState<DriveVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refreshDriveStatus = useCallback(async () => {
    if (!googleConnected) {
      setDriveConnected(false);
      return;
    }
    try {
      const status = await api.autoimgDriveStatus();
      setDriveConnected(status.connected);
    } catch {
      setDriveConnected(false);
    }
  }, [googleConnected]);

  useEffect(() => {
    refreshDriveStatus();
  }, [refreshDriveStatus]);

  const handleVerify = async () => {
    if (!folderInput.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    setVerified(null);
    try {
      const res = await api.autoimgDriveVerifyFolder(folderInput.trim());
      setVerified(res);
      if (!folderName.trim()) setFolderName(res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo acceder a la carpeta');
    } finally {
      setLoading(false);
    }
  };

  const handleAddFolder = async () => {
    if (!verified) return;
    const name = folderName.trim() || verified.name;
    setAdding(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.autoimgFoldersAdd({ name, folder_id: verified.folder_id, activo: true });
      setSuccess(`"${name}" agregada`);
      setFolderInput('');
      setFolderName('');
      setVerified(null);
      await onFolderAdded?.(result.folders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar carpeta');
    } finally {
      setAdding(false);
    }
  };

  if (!googleConnected) return null;

  const parsedId = parseDriveFolderId(folderInput);

  return (
    <SidebarSection
      icon={HardDrive}
      title="Drive"
      badge={driveConnected ? <StatusChip ok label="Listo" /> : undefined}
    >
      <input
        type="text"
        value={folderInput}
        onChange={(e) => {
          setFolderInput(e.target.value);
          setVerified(null);
          setError('');
          setSuccess('');
        }}
        placeholder="URL o ID de carpeta"
        className={`${INPUT_SM_CLASS} font-mono`}
      />
      {parsedId && folderInput.includes('/') && (
        <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">ID: {parsedId}</p>
      )}

      <button
        type="button"
        onClick={handleVerify}
        disabled={loading || !folderInput.trim()}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] disabled:opacity-40"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
        Verificar
      </button>

      {verified && (
        <div className="mt-2.5 space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[var(--accent-green)]" />
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[var(--text-primary)]">{verified.name}</p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {verified.image_count}{verified.has_more ? '+' : ''} imagen
                {verified.image_count !== 1 || verified.has_more ? 'es' : ''}
              </p>
            </div>
          </div>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Nombre en el registro"
            className={INPUT_SM_CLASS}
          />
          <button
            type="button"
            onClick={handleAddFolder}
            disabled={adding}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-primary)] py-1.5 text-[11px] font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-40"
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Agregar
          </button>
        </div>
      )}

      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {success && <InlineMessage tone="success">{success}</InlineMessage>}
    </SidebarSection>
  );
}
