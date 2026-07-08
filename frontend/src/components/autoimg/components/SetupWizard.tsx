import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Sheet,
  User,
} from 'lucide-react';
import { api, onNotify } from '../../../api';
import { parseDriveFolderId } from '../utils/parseDriveFolderId';
import { parseSheetId } from '../utils/parseSheetId';
import type { DriveVerifyResult } from '../types';
import { ActionButton, INPUT_CLASS, InlineMessage } from './shared';

interface SetupWizardProps {
  oauthConfigured: boolean;
  connected: boolean;
  sheetLinked: boolean;
  folderCount: number;
  lastSync?: string;
  onRefresh: () => void;
}

type StepId = 'oauth' | 'google' | 'sheet' | 'folder' | 'scan';

const STEPS: { id: StepId; label: string; short: string; icon: typeof KeyRound }[] = [
  { id: 'oauth', label: 'Credenciales OAuth', short: 'OAuth', icon: KeyRound },
  { id: 'google', label: 'Cuenta Google', short: 'Cuenta', icon: User },
  { id: 'sheet', label: 'Sheet maestro', short: 'Sheet', icon: Sheet },
  { id: 'folder', label: 'Carpeta Drive', short: 'Carpeta', icon: FolderOpen },
  { id: 'scan', label: 'Primer escaneo', short: 'Escaneo', icon: RefreshCw },
];

function stepDone(id: StepId, props: SetupWizardProps): boolean {
  switch (id) {
    case 'oauth':
      return props.oauthConfigured;
    case 'google':
      return props.connected;
    case 'sheet':
      return props.sheetLinked;
    case 'folder':
      return props.folderCount > 0;
    case 'scan':
      return Boolean(props.lastSync);
    default:
      return false;
  }
}

export function isSetupComplete(props: SetupWizardProps): boolean {
  return STEPS.every((step) => stepDone(step.id, props));
}

export default function SetupWizard(props: SetupWizardProps) {
  const { sheetLinked, folderCount, onRefresh } = props;

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [folderName, setFolderName] = useState('');
  const [verified, setVerified] = useState<DriveVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const currentStep = useMemo(() => {
    for (const step of STEPS) {
      if (!stepDone(step.id, props)) return step.id;
    }
    return null;
  }, [props]);

  const doneCount = useMemo(
    () => STEPS.filter((s) => stepDone(s.id, props)).length,
    [props],
  );
  const progressPct = Math.round((doneCount / STEPS.length) * 100);

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.auth.complete') {
        setAwaitingAuth(false);
        setAuthUrl('');
        setError('');
        onRefresh();
      }
      if (method === 'autoimg.auth.error' && params && typeof params === 'object') {
        const p = params as { message?: string };
        setAwaitingAuth(false);
        setError(p.message || 'Error al conectar con Google');
      }
    });
  }, [onRefresh]);

  useEffect(() => {
    if (!sheetLinked) return;
    api.autoimgSheetsGetConfig().then((config) => {
      if (config.sheet_id) setSheetId(config.sheet_id);
    }).catch(() => {});
  }, [sheetLinked]);

  const handleSaveOAuth = useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.autoimgOAuthConfigSave(clientId.trim(), clientSecret.trim());
      setClientSecret('');
      setNotice('Credenciales guardadas');
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar credenciales');
    } finally {
      setLoading(false);
    }
  }, [clientId, clientSecret, onRefresh]);

  const handleStartAuth = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { url } = await api.autoimgSheetsAuthUrl();
      setAuthUrl(url);
      setAwaitingAuth(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenSheet = useCallback(async () => {
    const resolved = parseSheetId(sheetId);
    if (!resolved) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.autoimgSheetsOpen(resolved);
      if (res.success) {
        setNotice(res.created_tabs?.length
          ? `Sheet vinculado · pestañas creadas: ${res.created_tabs.join(', ')}`
          : 'Sheet vinculado correctamente');
        onRefresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al abrir Sheet');
    } finally {
      setLoading(false);
    }
  }, [sheetId, onRefresh]);

  const resolvedFolderId = parseDriveFolderId(folderInput) || folderInput.trim();

  const handleVerifyFolder = useCallback(async () => {
    if (!resolvedFolderId) return;
    setLoading(true);
    setError('');
    setVerified(null);
    try {
      const res = await api.autoimgDriveVerifyFolder(resolvedFolderId);
      setVerified(res);
      if (!folderName.trim()) setFolderName(res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo verificar la carpeta');
    } finally {
      setLoading(false);
    }
  }, [resolvedFolderId, folderName]);

  const handleAddFolder = useCallback(async () => {
    if (!verified) return;
    setLoading(true);
    setError('');
    try {
      await api.autoimgFoldersAdd({
        name: folderName.trim() || verified.name,
        folder_id: verified.folder_id,
        activo: true,
      });
      setFolderInput('');
      setFolderName('');
      setVerified(null);
      setNotice(`Carpeta "${verified.name}" agregada`);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar carpeta');
    } finally {
      setLoading(false);
    }
  }, [verified, folderName, onRefresh]);

  const handleScanAndSync = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await api.autoimgScanAndSync();
      setNotice('Primer escaneo completado');
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al escanear');
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  if (!currentStep) return null;

  const activeMeta = STEPS.find((s) => s.id === currentStep);

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Configuración inicial
            </p>
            <h2 className="mt-1 text-[14px] font-medium text-[var(--text-primary)]">
              Conecta Google → Sheet → Drive → primer escaneo
            </h2>
            <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-[var(--text-muted)]">
              Completa el pipeline en orden. Cada paso desbloquea el siguiente.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-light tabular-nums text-[var(--text-primary)]">
              {doneCount}
              <span className="text-[12px] text-[var(--text-muted)]">/{STEPS.length}</span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">pasos listos</p>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div
            className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ol className="mt-4 flex flex-wrap gap-1.5">
          {STEPS.map((step, index) => {
            const done = stepDone(step.id, props);
            const active = step.id === currentStep;
            const Icon = step.icon;
            return (
              <li
                key={step.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                  active
                    ? 'border-[var(--accent-primary)]/40 bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--text-primary)]'
                    : done
                      ? 'border-[color-mix(in_srgb,var(--accent-green)_25%,transparent)] text-[var(--accent-green)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
                }`}
              >
                {done ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-base)] font-mono text-[9px]">
                    {active ? <Icon size={10} /> : index + 1}
                  </span>
                )}
                <span className="hidden sm:inline">{step.label}</span>
                <span className="sm:hidden">{step.short}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="p-4 md:p-5">
        {activeMeta && (
          <p className="mb-3 text-[11px] font-medium text-[var(--text-secondary)]">
            Paso actual: {activeMeta.label}
          </p>
        )}

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          {currentStep === 'oauth' && (
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Client ID y Client Secret de tu proyecto en Google Cloud Console (APIs Sheets + Drive).
              </p>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Client ID"
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Client Secret"
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <ActionButton
                variant="primary"
                onClick={handleSaveOAuth}
                disabled={loading || !clientId.trim() || !clientSecret.trim()}
              >
                {loading ? 'Guardando…' : 'Guardar credenciales'}
              </ActionButton>
            </div>
          )}

          {currentStep === 'google' && (
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Autoriza el acceso a Google Sheets y Drive desde tu navegador.
              </p>
              {awaitingAuth ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <Loader2 size={12} className="animate-spin" />
                    Esperando autorización…
                  </div>
                  {authUrl && (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary-hover)] underline-offset-2 hover:underline"
                    >
                      <ExternalLink size={11} />
                      Reabrir enlace de autorización
                    </a>
                  )}
                </>
              ) : (
                <ActionButton variant="secondary" onClick={handleStartAuth} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                  Conectar con Google
                </ActionButton>
              )}
            </div>
          )}

          {currentStep === 'sheet' && (
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Pega la URL o el ID del Sheet maestro donde vive el padrón BD_IMG.
              </p>
              <input
                type="text"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder="URL o Sheet ID"
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <ActionButton
                variant="solid"
                onClick={handleOpenSheet}
                disabled={loading || !parseSheetId(sheetId)}
              >
                {loading ? 'Vinculando…' : 'Vincular Sheet'}
              </ActionButton>
            </div>
          )}

          {currentStep === 'folder' && (
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Agrega al menos una carpeta de Drive con las imágenes a inventariar.
              </p>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => {
                  setFolderInput(e.target.value);
                  setVerified(null);
                }}
                placeholder="URL o Folder ID de Drive"
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              {verified && (
                <p className="text-[11px] text-[var(--accent-green)]">
                  {verified.name} · {verified.image_count} imagen(es)
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  variant="secondary"
                  onClick={handleVerifyFolder}
                  disabled={loading || !resolvedFolderId}
                >
                  Verificar
                </ActionButton>
                <ActionButton
                  variant="solid"
                  onClick={handleAddFolder}
                  disabled={loading || !verified}
                >
                  Agregar carpeta
                </ActionButton>
              </div>
            </div>
          )}

          {currentStep === 'scan' && (
            <div className="space-y-2.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Escanea las carpetas activas y escribe el resultado en BD_IMG.
              </p>
              <ActionButton
                variant="primary"
                onClick={handleScanAndSync}
                disabled={loading || folderCount === 0}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Escanear y sincronizar
              </ActionButton>
            </div>
          )}
        </div>

        {notice && (
          <div className="mt-3">
            <InlineMessage tone="success">{notice}</InlineMessage>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <InlineMessage tone="error">{error}</InlineMessage>
          </div>
        )}
      </div>
    </div>
  );
}
