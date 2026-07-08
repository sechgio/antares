import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import type { AutoImgFolder, DriveVerifyResult } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { ActionButton, EmptyState, INPUT_CLASS, SectionCard } from './shared';

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
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<DriveVerifyResult | null>(null);
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

  const handleVerify = async () => {
    if (!resolvedFolderId) return;
    setVerifying(true);
    setError('');
    setVerified(null);
    try {
      const res = await api.autoimgDriveVerifyFolder(resolvedFolderId);
      setVerified(res);
      if (!name.trim()) setName(res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo verificar la carpeta');
    } finally {
      setVerifying(false);
    }
  };

  const handleAdd = async () => {
    if (!verified) return;
    const folderName = name.trim() || verified.name;
    setLoading(true);
    try {
      await api.autoimgFoldersAdd({ name: folderName, folder_id: verified.folder_id, activo });
      setName('');
      setFolderId('');
      setVerified(null);
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

  const activeCount = folders.filter((f) => f.activo).length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <p className="text-[12px] font-medium text-[var(--text-primary)]">Carpetas registradas</p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              Fuentes de Drive que se incluyen en el escaneo
            </p>
          </div>
          {folders.length > 0 && (
            <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {activeCount}/{folders.length} activas
            </span>
          )}
        </div>

        {loading && !folders.length ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : folders.length > 0 ? (
          <div className="divide-y divide-[var(--border-subtle)]">
            {folders.map((f) => (
              <div
                key={f.folder_id}
                className={`flex items-center gap-3 px-4 py-3 transition-opacity ${
                  f.activo ? '' : 'opacity-55'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(f)}
                  disabled={loading}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                    f.activo ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'
                  }`}
                  title={f.activo ? 'Desactivar' : 'Activar'}
                  aria-label={f.activo ? `Desactivar ${f.name}` : `Activar ${f.name}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      f.activo ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <FolderOpen size={14} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--text-primary)]">{f.name}</p>
                  <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">{f.folder_id}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                    {f.cant_archivos || '—'}
                  </p>
                  <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">archivos</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(f.folder_id)}
                  disabled={loading}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] hover:text-[var(--accent-red)] disabled:opacity-40"
                  aria-label={`Eliminar ${f.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="Sin carpetas"
            description="Agrega una carpeta de Drive compartida para empezar a escanear imágenes."
          />
        )}
      </div>

      <SectionCard
        title="Nueva carpeta"
        subtitle="También puedes agregar carpetas desde el panel Google Drive en la barra lateral."
      >
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre descriptivo"
            className={`${INPUT_CLASS} text-xs`}
          />
          <input
            type="text"
            value={folderId}
            onChange={(e) => {
              setFolderId(e.target.value);
              setVerified(null);
            }}
            placeholder="URL o Folder ID de Drive"
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          {verified && (
            <p className="flex items-center gap-1.5 text-[11px] text-[var(--accent-green)]">
              <CheckCircle2 size={12} />
              {verified.name} · {verified.image_count} imagen(es)
            </p>
          )}
          {resolvedFolderId && folderId.includes('/') && (
            <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">
              ID: {resolvedFolderId}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="rounded accent-[var(--accent-primary)]"
            />
            Activar al agregar
          </label>
          <div className="flex gap-2">
            <ActionButton
              variant="secondary"
              onClick={handleVerify}
              disabled={loading || verifying || !resolvedFolderId}
            >
              {verifying ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Verificando…
                </>
              ) : (
                'Verificar'
              )}
            </ActionButton>
            <ActionButton variant="solid" onClick={handleAdd} disabled={loading || !verified}>
              Agregar
            </ActionButton>
          </div>
        </div>
        {error && <p className="mt-2 text-[11px] text-[var(--accent-red)]">{error}</p>}
      </SectionCard>
    </div>
  );
}
