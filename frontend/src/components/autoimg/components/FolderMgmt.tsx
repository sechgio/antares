import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import type { AutoImgFolder, DriveVerifyResult } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { ActionButton, INPUT_CLASS } from './shared';
import { FolderPreviewStrip, useFolderPreviews } from './FolderPreviewStrip';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface FolderMgmtProps {
  folders?: AutoImgFolder[];
  onFoldersChange?: (folders?: AutoImgFolder[]) => void | Promise<void>;
}

type FolderMutationResult = { success: boolean; folders?: AutoImgFolder[] };

function Switch({
  checked,
  onChange,
  disabled,
  label,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  title?: string;
}) {
  return (
    <WithHoverTooltip label={title} placement="bottom">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-out active:scale-[0.97] disabled:opacity-40 ${
          checked ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </WithHoverTooltip>
  );
}

function AddFolderForm({
  name,
  folderId,
  activo,
  verified,
  resolvedFolderId,
  loading,
  verifying,
  error,
  compact,
  onNameChange,
  onFolderIdChange,
  onActivoChange,
  onVerify,
  onAdd,
}: {
  name: string;
  folderId: string;
  activo: boolean;
  verified: DriveVerifyResult | null;
  resolvedFolderId: string;
  loading: boolean;
  verifying: boolean;
  error: string;
  compact?: boolean;
  onNameChange: (v: string) => void;
  onFolderIdChange: (v: string) => void;
  onActivoChange: () => void;
  onVerify: () => void;
  onAdd: () => void;
}) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-[var(--text-muted)]">
            Nombre
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Nombre descriptivo"
            className={`${INPUT_CLASS} text-[13px]`}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-[var(--text-muted)]">
            Carpeta de Drive
          </span>
          <input
            type="text"
            value={folderId}
            onChange={(e) => onFolderIdChange(e.target.value)}
            placeholder="URL o Folder ID de Drive"
            className={`${INPUT_CLASS} font-mono text-[12px]`}
          />
        </label>
        {verified && (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--accent-green)]">
            <CheckCircle2 size={12} strokeWidth={2} />
            {verified.name} · {verified.image_count}{verified.has_more ? '+' : ''} imagen(es)
          </p>
        )}
        {resolvedFolderId && folderId.includes('/') && (
          <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            ID: {resolvedFolderId}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Switch
            checked={activo}
            onChange={onActivoChange}
            disabled={loading}
            label="Activar al agregar"
          />
          <span className="text-[12px] text-[var(--text-secondary)]">Activar al agregar</span>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton
            variant="secondary"
            onClick={onVerify}
            disabled={loading || verifying || !resolvedFolderId}
            className="px-3 py-2 text-[12px]"
          >
            {verifying ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Verificando…
              </>
            ) : (
              'Verificar'
            )}
          </ActionButton>
          <ActionButton
            variant="solid"
            onClick={onAdd}
            disabled={loading || verifying || !resolvedFolderId}
            className="px-3.5 py-2 text-[12px]"
          >
            <Plus size={13} strokeWidth={2.25} />
            Agregar
          </ActionButton>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-[color-mix(in_srgb,var(--accent-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-red)_8%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--accent-red)]">
          {error}
        </p>
      )}
    </div>
  );
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
  const verifyRequestRef = useRef(0);
  const folderIdInputRef = useRef(folderId);
  folderIdInputRef.current = folderId;

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

  const folderIds = folders.map((f) => f.folder_id);
  const { previews, invalidate: invalidatePreview } = useFolderPreviews(folderIds);

  const reconcileMutation = useCallback(async (result: FolderMutationResult) => {
    if (result.folders) {
      setFolders(result.folders);
      await onFoldersChange?.(result.folders);
      return;
    }
    await load(true);
  }, [load, onFoldersChange]);

  const resolvedFolderId = parseDriveFolderId(folderId) || folderId.trim();

  const handleVerify = async () => {
    if (!resolvedFolderId) return;
    const folderIdAtStart = resolvedFolderId;
    const requestId = ++verifyRequestRef.current;
    setVerifying(true);
    setError('');
    setVerified(null);
    try {
      const res = await api.autoimgDriveVerifyFolder(folderIdAtStart);
      const folderIdNow =
        parseDriveFolderId(folderIdInputRef.current) || folderIdInputRef.current.trim();
      if (requestId !== verifyRequestRef.current || folderIdAtStart !== folderIdNow) return;
      setVerified(res);
      if (!name.trim()) setName(res.name);
    } catch (e) {
      const folderIdNow =
        parseDriveFolderId(folderIdInputRef.current) || folderIdInputRef.current.trim();
      if (requestId !== verifyRequestRef.current || folderIdAtStart !== folderIdNow) return;
      setError(e instanceof Error ? e.message : 'No se pudo verificar la carpeta');
    } finally {
      setVerifying(false);
    }
  };

  /** Agregar no exige un Verificar previo: el backend ya valida el folder en Drive. */
  const handleAdd = async () => {
    if (!resolvedFolderId) return;
    setLoading(true);
    setError('');
    try {
      let folderName = name.trim();
      let id = verified?.folder_id || resolvedFolderId;
      if (!folderName) {
        const res = verified ?? (await api.autoimgDriveVerifyFolder(resolvedFolderId));
        if (!verified) setVerified(res);
        folderName = res.name || id;
        id = res.folder_id || id;
      }
      const result = await api.autoimgFoldersAdd({ name: folderName, folder_id: id, activo });
      setName('');
      setFolderId('');
      setVerified(null);
      await reconcileMutation(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar carpeta');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (folder: AutoImgFolder) => {
    setLoading(true);
    try {
      const result = await api.autoimgFoldersToggle({ folder_id: folder.folder_id, activo: !folder.activo });
      await reconcileMutation(result);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    setLoading(true);
    try {
      const result = await api.autoimgFoldersRemove({ folder_id: id });
      invalidatePreview(id);
      await reconcileMutation(result);
    } finally {
      setLoading(false);
    }
  };

  const activeCount = folders.filter((f) => f.activo).length;
  const isEmpty = folders.length === 0;
  const formProps = {
    name,
    folderId,
    activo,
    verified,
    resolvedFolderId,
    loading,
    verifying,
    error,
    onNameChange: setName,
    onFolderIdChange: (v: string) => {
      setFolderId(v);
      setVerified(null);
    },
    onActivoChange: () => setActivo((a) => !a),
    onVerify: handleVerify,
    onAdd: handleAdd,
  };

  if (loading && isEmpty) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
              <FolderOpen size={20} strokeWidth={1.5} />
            </div>
            <h2 className="text-[15px] font-medium tracking-tight text-[var(--text-primary)]">
              Sin carpetas
            </h2>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[12px] leading-relaxed text-[var(--text-muted)]">
              Agrega una carpeta de Drive compartida para empezar a escanear imágenes.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 p-5 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] backdrop-blur-sm">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Nueva carpeta
            </p>
            <AddFolderForm {...formProps} />
          </div>

          <p className="mt-4 text-center text-[11px] text-[var(--text-muted)]">
            También desde Google Drive en la barra lateral
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <p className="text-[12px] font-medium tracking-tight text-[var(--text-primary)]">
              Carpetas registradas
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              Fuentes de Drive incluidas en el escaneo
            </p>
          </div>
          <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-[10px] tabular-nums text-[var(--text-muted)]">
            {activeCount}/{folders.length} activas
          </span>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {folders.map((f) => (
            <div
              key={f.folder_id}
              className={`px-4 py-3 transition-opacity duration-200 ${
                f.activo ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Switch
                  checked={f.activo}
                  onChange={() => handleToggle(f)}
                  disabled={loading}
                  label={f.activo ? `Desactivar ${f.name}` : `Activar ${f.name}`}
                  title={f.activo ? 'Desactivar' : 'Activar'}
                />
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <FolderOpen size={14} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--text-primary)]">{f.name}</p>
                  <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">{f.folder_id}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[12px] tabular-nums text-[var(--text-secondary)]">
                    {f.cant_archivos || '—'}
                  </p>
                  <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">archivos</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(f.folder_id)}
                  disabled={loading}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors duration-150 active:scale-[0.97] hover:bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] hover:text-[var(--accent-red)] disabled:opacity-40"
                  aria-label={`Eliminar ${f.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="pl-[5.75rem]">
                <FolderPreviewStrip state={previews[f.folder_id]} folderName={f.name} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 p-4 backdrop-blur-sm">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Agregar carpeta
        </p>
        <AddFolderForm {...formProps} compact />
      </div>
    </div>
  );
}
