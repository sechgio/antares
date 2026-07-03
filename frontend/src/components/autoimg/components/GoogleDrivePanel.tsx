import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Plus } from 'lucide-react';
import { api } from '../../../api';
import type { DriveVerifyResult } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { INPUT_CLASS, SectionCard } from './shared';

interface GoogleDrivePanelProps {
  googleConnected: boolean;
  onFolderAdded?: () => void;
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

  useEffect(() => { refreshDriveStatus(); }, [refreshDriveStatus]);

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
      await api.autoimgFoldersAdd({ name, folder_id: verified.folder_id, activo: true });
      setSuccess(`"${name}" agregada al registro`);
      setFolderInput('');
      setFolderName('');
      setVerified(null);
      onFolderAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar carpeta');
    } finally {
      setAdding(false);
    }
  };

  const parsedId = parseDriveFolderId(folderInput);

  if (!googleConnected) {
    return (
      <SectionCard title="Google Drive">
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Conecta tu cuenta Google primero para acceder a carpetas en Compartidos.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Google Drive">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${driveConnected ? 'bg-emerald-400' : 'bg-[var(--text-muted)]/40'}`} />
        <span className="text-[11px] text-[var(--text-muted)]">
          {driveConnected ? 'Drive listo · solo lectura' : 'Sin acceso a Drive'}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Pega la URL o el ID de una carpeta de Compartidos para verificar el acceso.
      </p>

      <input
        type="text"
        value={folderInput}
        onChange={(e) => {
          setFolderInput(e.target.value);
          setVerified(null);
          setError('');
          setSuccess('');
        }}
        placeholder="URL o Folder ID"
        className={`${INPUT_CLASS} font-mono text-xs`}
      />
      {parsedId && folderInput.includes('/') && (
        <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">ID: {parsedId}</p>
      )}

      <button
        type="button"
        onClick={handleVerify}
        disabled={loading || !folderInput.trim()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-medium)] py-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
        Probar conexión
      </button>

      {verified && (
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="truncate text-[12px] text-[var(--text-primary)]">{verified.name}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {verified.image_count} imagen{verified.image_count !== 1 ? 'es' : ''} encontrada{verified.image_count !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {verified.sample_files.length > 0 && (
            <ul className="space-y-0.5 pl-5">
              {verified.sample_files.map((file) => (
                <li key={file} className="truncate font-mono text-[10px] text-[var(--text-muted)]">{file}</li>
              ))}
            </ul>
          )}
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Nombre en el registro"
            className={`${INPUT_CLASS} text-xs`}
          />
          <button
            type="button"
            onClick={handleAddFolder}
            disabled={adding}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] py-2 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Agregar al registro
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {success && <p className="mt-2 text-[11px] text-emerald-400/90">{success}</p>}
    </SectionCard>
  );
}