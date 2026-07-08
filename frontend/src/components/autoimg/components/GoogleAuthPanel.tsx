import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, LogOut, Pencil, Sheet, User } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { parseSheetId } from '../utils/parseSheetId';
import {
  INPUT_SM_CLASS,
  InlineMessage,
  SidebarSection,
  StatusChip,
} from './shared';

interface GoogleAuthPanelProps {
  onAuthChange?: (connected: boolean) => void;
  onSheetLinked?: () => void;
}

export default function GoogleAuthPanel({ onAuthChange, onSheetLinked }: GoogleAuthPanelProps) {
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [savedClientIdMasked, setSavedClientIdMasked] = useState('');
  const [editingOAuth, setEditingOAuth] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetNotice, setSheetNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshOAuthConfig = useCallback(async () => {
    try {
      const status = await api.autoimgOAuthConfigStatus();
      setOauthConfigured(status.configured);
      setSavedClientIdMasked(status.client_id_masked || '');
      if (status.configured) setEditingOAuth(false);
    } catch {
      setOauthConfigured(false);
      setSavedClientIdMasked('');
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await api.autoimgSheetsAuthStatus();
      setConnected(status.authenticated);
      setEmail(status.email || '');
      onAuthChange?.(status.authenticated);
      return status.authenticated;
    } catch {
      setConnected(false);
      setEmail('');
      onAuthChange?.(false);
      return false;
    }
  }, [onAuthChange]);

  const refreshSheetConfig = useCallback(async () => {
    try {
      const config = await api.autoimgSheetsGetConfig();
      if (config.sheet_id) {
        setSheetId(config.sheet_id);
        setSheetName(config.name || config.sheet_id);
        if (config.linked) onSheetLinked?.();
      }
    } catch {
      /* sheet not linked yet */
    }
  }, [onSheetLinked]);

  useEffect(() => {
    refreshOAuthConfig();
    void refreshStatus().then((authenticated) => {
      if (authenticated) void refreshSheetConfig();
    });
  }, [refreshOAuthConfig, refreshStatus, refreshSheetConfig]);

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.auth.complete' && params && typeof params === 'object') {
        const p = params as { authenticated?: boolean; email?: string };
        setAwaitingAuth(false);
        setAuthUrl('');
        setError('');
        setConnected(!!p.authenticated);
        setEmail(p.email || '');
        onAuthChange?.(!!p.authenticated);
        if (p.authenticated) void refreshSheetConfig();
      }
      if (method === 'autoimg.auth.error' && params && typeof params === 'object') {
        const p = params as { message?: string };
        setAwaitingAuth(false);
        setError(p.message || 'Error al conectar con Google');
      }
    });
  }, [onAuthChange, refreshSheetConfig]);

  const handleSaveOAuth = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.autoimgOAuthConfigSave(clientId.trim(), clientSecret.trim());
      setClientSecret('');
      await refreshOAuthConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar credenciales');
    } finally {
      setLoading(false);
    }
  };

  const handleStartAuth = async () => {
    setLoading(true);
    setError('');
    setAuthUrl('');
    try {
      const { url } = await api.autoimgSheetsAuthUrl();
      setAuthUrl(url);
      setAwaitingAuth(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de autenticación');
      setAwaitingAuth(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAuth = async () => {
    setLoading(true);
    try {
      await api.autoimgSheetsAuthCancel();
    } finally {
      setAwaitingAuth(false);
      setAuthUrl('');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await api.autoimgSheetsAuthRevoke();
      // Cerrar sesión: limpia UI. Sheet/carpetas de este usuario quedan en disco
      // cifrados bajo su hash; se restauran al volver a conectar con el mismo Google.
      setEmail('');
      setSheetId('');
      setSheetName('');
      setSheetNotice('');
      setAuthUrl('');
      setAwaitingAuth(false);
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  };

  const resolvedSheetId = parseSheetId(sheetId);

  const handleOpenSheet = async () => {
    if (!resolvedSheetId) return;
    setLoading(true);
    setError('');
    setSheetNotice('');
    try {
      const res = await api.autoimgSheetsOpen(resolvedSheetId);
      if (res.success) {
        setSheetName(res.name || sheetId);
        if (res.created_tabs?.length) {
          setSheetNotice(`Pestañas creadas: ${res.created_tabs.join(', ')}`);
        }
        onSheetLinked?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al abrir Sheet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SidebarSection
        icon={KeyRound}
        title="OAuth"
        badge={oauthConfigured && !editingOAuth ? <StatusChip ok label="Listo" /> : undefined}
      >
        {oauthConfigured && !editingOAuth ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
              {savedClientIdMasked}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingOAuth(true);
                setClientSecret('');
              }}
              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
            >
              <Pencil size={10} />
              Editar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client ID"
              className={`${INPUT_SM_CLASS} font-mono`}
            />
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              className={`${INPUT_SM_CLASS} font-mono`}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveOAuth}
                disabled={loading || !clientId.trim() || !clientSecret.trim()}
                className="flex-1 rounded-md bg-[var(--accent-primary)] py-1.5 text-[11px] font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-40"
              >
                {loading ? 'Guardando…' : 'Guardar'}
              </button>
              {oauthConfigured && (
                <button
                  type="button"
                  onClick={() => setEditingOAuth(false)}
                  className="rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}
      </SidebarSection>

      <SidebarSection
        icon={User}
        title="Cuenta Google"
        badge={connected ? <StatusChip ok label="Activa" /> : undefined}
        muted={!oauthConfigured}
      >
        {!oauthConfigured ? (
          <p className="text-[10px] text-[var(--text-muted)]">Guarda OAuth primero.</p>
        ) : connected ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
              {email || 'Conectado'}
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading}
              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <LogOut size={10} />}
              Salir
            </button>
          </div>
        ) : awaitingAuth ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <Loader2 size={11} className="shrink-0 animate-spin" />
              Esperando autorización…
            </div>
            {authUrl && (
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-primary-hover)] underline-offset-2 hover:underline"
              >
                <ExternalLink size={10} />
                Reabrir enlace
              </a>
            )}
            <button
              type="button"
              onClick={handleCancelAuth}
              disabled={loading}
              className="text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleStartAuth}
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] py-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
            Conectar con Google
          </button>
        )}
      </SidebarSection>

      {connected && (
        <SidebarSection
          icon={Sheet}
          title="Sheet"
          badge={sheetName ? <StatusChip ok label="Vinculado" /> : undefined}
        >
          <div className="flex gap-1.5">
            <input
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="URL o ID del Sheet"
              className={`${INPUT_SM_CLASS} min-w-0 flex-1 font-mono`}
            />
            <button
              type="button"
              onClick={handleOpenSheet}
              disabled={loading || !resolvedSheetId}
              className="shrink-0 rounded-md border border-[var(--border-medium)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Vincular
            </button>
          </div>
          {sheetName && (
            <p className="mt-1.5 truncate text-[10px] text-[var(--text-muted)]" title={sheetName}>
              {sheetName}
            </p>
          )}
          {sheetNotice && <InlineMessage tone="success">{sheetNotice}</InlineMessage>}
        </SidebarSection>
      )}

      {error && (
        <div className="px-4 pb-3">
          <InlineMessage tone="error">{error}</InlineMessage>
        </div>
      )}
    </>
  );
}
