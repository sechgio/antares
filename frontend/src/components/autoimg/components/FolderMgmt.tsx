import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import type { AutoImgFolder } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { EmptyState, INPUT_CLASS, SectionCard } from './shared';

interface FolderMgmtProps {
  folders?: AutoImgFolder[];
  onFoldersChange?: () => void | Promise<void>;
}

export default function FolderMgmt({ folders: externalFolders, onFoldersChange }: FolderMgmtProps) {
  const [folders, setFolders] = useState<AutoImgFolder[]>(externalFolders ?? []);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      if (onFoldersChange && force) {
        await onFoldersChange();
      } else {
        setFolders((await api.autoimgFoldersList(force)).folders);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [onFoldersChange]);

  useEffect(() => {
    if (externalFolders) setFolders(externalFolders);
  }, [externalFolders]);

  useEffect(() => {
    if (!externalFolders) load(false);
  }, [externalFolders, load]);

  const resolvedFolderId = parseDriveFolderId(folderId) || folderId.trim();

  const handleAdd = async () => {
    if (!name.trim() || !resolvedFolderId) return;
    setLoading(true);
    try {
      await api.autoimgFoldersAdd({ name: name.trim(), folder_id: resolvedFolderId, activo });
      setName('');
      setFolderId('');
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (folder: AutoImgFolder) => {
    setLoading(true);
    try {
      await api.autoimgFoldersToggle({ folder_id: folder.folder_id, activo: !folder.activo });
      await load(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    setLoading(true);
    try {
      await api.autoimgFoldersRemove({ folder_id: id });
      await load(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <div className="rounded-xl border border-[var(--border-subtle)]">
        {loading && !folders.length ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : folders.length > 0 ? (
          <div className="divide-y divide-[var(--border-subtle)]">
            {folders.map((f) => (
              <div key={f.folder_id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleToggle(f)}
                  disabled={loading}
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors ${f.activo ? 'bg-emerald-400' : 'bg-[var(--text-muted)]/30'}`}
                  title={f.activo ? 'Activa' : 'Inactiva'}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--text-primary)]">{f.name}</p>
                  <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">{f.folder_id}</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                  {f.cant_archivos || '—'}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(f.folder_id)}
                  disabled={loading}
                  className="shrink-0 p-1 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin carpetas" description="Agrega una carpeta de Drive para escanear." />
        )}
      </div>

      <SectionCard title="Nueva carpeta">
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          También puedes agregar carpetas desde el panel Google Drive en la barra lateral.
        </p>
        <div className="space-y-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre descriptivo" className={`${INPUT_CLASS} text-xs`} />
          <input
            type="text"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            placeholder="URL o Folder ID de Drive"
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          {resolvedFolderId && folderId.includes('/') && (
            <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">ID: {resolvedFolderId}</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="rounded accent-[var(--text-primary)]" />
            Activa
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={loading || !name.trim() || !resolvedFolderId}
            className="rounded-lg bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Agregar
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      </SectionCard>
    </div>
  );
}