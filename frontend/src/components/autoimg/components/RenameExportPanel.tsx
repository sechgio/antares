import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Square, Tag } from 'lucide-react';
import { api, onNotify } from '../../../api';
import type { DriveVerifyResult } from '../types';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { ActionButton, INPUT_CLASS, InlineMessage, SectionCard } from './shared';

interface RenameExportPanelProps {
  onDone?: () => void;
}

export default function RenameExportPanel({ onDone }: RenameExportPanelProps) {
  const [folderInput, setFolderInput] = useState('');
  const [verified, setVerified] = useState<DriveVerifyResult | null>(null);
  const [onlyCompletos, setOnlyCompletos] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; last?: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    dest_name: string;
    planned: number;
    copied: number;
    failed: number;
    skipped: number;
    destinos: string[];
    folders_created: string[];
    samples: string[];
    failSamples: string[];
    skipSamples: string[];
  } | null>(null);

  useEffect(() => {
    api.autoimgRenameDestConfig()
      .then((cfg) => {
        if (cfg.folder_id) setFolderInput(cfg.folder_id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.rename.progress' && params && typeof params === 'object') {
        const p = params as Record<string, unknown>;
        setProgress({
          current: Number(p.current) || 0,
          total: Number(p.total) || 0,
          last: p.last ? String(p.last) : undefined,
        });
      }
      if (method === 'autoimg.operation.cancelled') {
        setRunning(false);
        setProgress(null);
        setError('Operación cancelada');
      }
    });
  }, []);

  const verifyRequestRef = useRef(0);
  const folderInputRef = useRef(folderInput);
  folderInputRef.current = folderInput;

  const resolvedId = parseDriveFolderId(folderInput) || folderInput.trim();

  const handleVerify = useCallback(async () => {
    if (!resolvedId) return;
    const folderIdAtStart = resolvedId;
    const requestId = ++verifyRequestRef.current;
    setVerifying(true);
    setError('');
    setVerified(null);
    setResult(null);
    try {
      const res = await api.autoimgDriveVerifyFolder(folderIdAtStart);
      const folderIdNow =
        parseDriveFolderId(folderInputRef.current) || folderInputRef.current.trim();
      if (requestId !== verifyRequestRef.current || folderIdAtStart !== folderIdNow) return;
      setVerified(res);
    } catch (e) {
      const folderIdNow =
        parseDriveFolderId(folderInputRef.current) || folderInputRef.current.trim();
      if (requestId !== verifyRequestRef.current || folderIdAtStart !== folderIdNow) return;
      setError(e instanceof Error ? e.message : 'No se pudo verificar la carpeta');
    } finally {
      setVerifying(false);
    }
  }, [resolvedId]);

  const handleRun = useCallback(async () => {
    const dest = verified?.folder_id || resolvedId;
    if (!dest) return;
    setRunning(true);
    setError('');
    setResult(null);
    setProgress({ current: 0, total: 0 });
    try {
      const res = await api.autoimgRenameExport({
        dest_folder_id: dest,
        only_completos: onlyCompletos,
      });
      setResult({
        dest_name: res.dest_name,
        planned: res.planned,
        copied: res.copied.length,
        failed: res.failed.length,
        skipped: res.skipped.length,
        destinos: res.destinos || [],
        folders_created: res.folders_created || [],
        samples: res.copied
          .slice(0, 10)
          .map((c) => `${c.from} → ${c.destino || c.folder || '?'}/${c.to}`),
        failSamples: res.failed.slice(0, 5).map((f) => `${f.to}: ${f.error}`),
        skipSamples: res.skipped.slice(0, 6).map((s) => `${s.nis}: ${s.detail || s.reason}`),
      });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al renombrar');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [verified, resolvedId, onlyCompletos, onDone]);

  const handleCancel = useCallback(async () => {
    try {
      const res = await api.autoimgCancelOperation();
      if (!res.success) setError('No hay operación activa para cancelar');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar');
    }
  }, []);

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : running
        ? 5
        : 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <SectionCard
        title="Renombrar a SGIO"
        subtitle="Copia renombrada por SGIO en subcarpetas según la columna DESTINO de BD_IMG."
      >
        <div className="mb-3 space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
          <p>
            Nombre:{' '}
            <span className="font-mono text-[var(--text-secondary)]">6553447_1.jpg</span>
            {' → '}
            <span className="font-mono text-[var(--text-secondary)]">70942759_1.jpg</span>
            {' '}(SGIO, col. B)
          </p>
          <p>
            Carpeta:{' '}
            <span className="font-mono text-[var(--text-secondary)]">raíz / {'{DESTINO}'}</span>
            {' '}(col. C del Sheet). Se crea sola si no existe.
          </p>
        </div>

        <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Carpeta raíz (parent)
        </label>
        <input
          type="text"
          value={folderInput}
          onChange={(e) => {
            verifyRequestRef.current += 1;
            setFolderInput(e.target.value);
            setVerified(null);
            setResult(null);
            setError('');
          }}
          placeholder="URL o Folder ID de Drive (raíz)"
          className={`${INPUT_CLASS} font-mono text-xs`}
          disabled={running}
        />
        {resolvedId && folderInput.includes('/') && (
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">ID: {resolvedId}</p>
        )}
        <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
          Dentro de esta carpeta se crean automáticamente subcarpetas con el nombre de DESTINO.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ActionButton
            variant="secondary"
            onClick={handleVerify}
            disabled={verifying || running || !resolvedId}
          >
            {verifying ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
            Verificar raíz
          </ActionButton>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={onlyCompletos}
              onChange={(e) => setOnlyCompletos(e.target.checked)}
              disabled={running}
              className="rounded accent-[var(--accent-primary)]"
            />
            Solo NIS completos (3 fotos)
          </label>
        </div>

        {verified && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--accent-green)]" />
            <div className="min-w-0">
              <p className="truncate text-[12px] text-[var(--text-primary)]">{verified.name}</p>
              <p className="text-[10px] text-[var(--text-muted)]">
                Raíz lista · subcarpetas por DESTINO
              </p>
            </div>
          </div>
        )}

        <ActionButton
          variant="primary"
          onClick={handleRun}
          disabled={running || !(verified?.folder_id || resolvedId)}
          className="mt-4 w-full py-2.5 text-[13px]"
        >
          {running ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Escaneando y copiando…
            </>
          ) : (
            <>
              <Tag size={14} />
              Renombrar y organizar por DESTINO
            </>
          )}
        </ActionButton>

        {running && (
          <div className="mt-3 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                {progress && progress.total > 0
                  ? `${progress.current}/${progress.total}${progress.last ? ` · ${progress.last}` : ''}`
                  : 'Escaneo + carpetas DESTINO…'}
              </p>
              <ActionButton variant="danger" onClick={handleCancel} className="px-2 py-1 text-[10px]">
                <Square size={10} />
                Cancelar
              </ActionButton>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <InlineMessage tone="error">{error}</InlineMessage>
          </div>
        )}
      </SectionCard>

      {result && (
        <SectionCard title="Resultado">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Planificadas', value: result.planned },
              { label: 'Copiadas', value: result.copied },
              { label: 'Errores', value: result.failed },
              { label: 'Omitidas', value: result.skipped },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
              >
                <p className="text-[10px] text-[var(--text-muted)]">{item.label}</p>
                <p className="mt-0.5 text-lg font-light tabular-nums text-[var(--text-primary)]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            Raíz: <span className="text-[var(--text-secondary)]">{result.dest_name}</span>
            {result.destinos.length > 0 && (
              <>
                {' · '}
                {result.destinos.length} DESTINO
                {result.folders_created.length > 0 &&
                  ` · ${result.folders_created.length} carpeta(s) nuevas`}
              </>
            )}
          </p>
          {result.destinos.length > 0 && (
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {result.destinos.slice(0, 12).join(' · ')}
              {result.destinos.length > 12 ? '…' : ''}
            </p>
          )}
          {result.samples.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t border-[var(--border-subtle)] pt-2">
              {result.samples.map((line) => (
                <li key={line} className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {result.failSamples.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {result.failSamples.map((line) => (
                <li key={line} className="truncate text-[10px] text-[var(--accent-red)]">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {result.skipSamples.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {result.skipSamples.map((line) => (
                <li key={line} className="truncate text-[10px] text-[var(--text-muted)]">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
