import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, LogOut } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { INPUT_CLASS, SectionCard } from './shared';

interface GoogleAuthPanelProps {
  onAuthChange?: (connected: boolean) => void;
  onSheetLinked?: () => void;
}

export default function GoogleAuthPanel({ onAuthChange, onSheetLinked }: GoogleAuthPanelProps) {
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [savedClientIdMasked, setSavedClientIdMasked] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshOAuthConfig = useCallback(async () => {
    try {
      const status = await api.autoimgOAuthConfigStatus();
      setOauthConfigured(status.configured);
      setSavedClientIdMasked(status.client_id_masked || '');
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
    setRedirectUri('');
    try {
      const { url, redirect_uri } = await api.autoimgSheetsAuthUrl();
      setAuthUrl(url);
      setRedirectUri(redirect_uri);
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
      setRedirectUri('');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await api.autoimgSheetsAuthRevoke();
      setSheetName('');
      setEmail('');
      setAuthUrl('');
      setRedirectUri('');
      setAwaitingAuth(false);
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSheet = async () => {
    if (!sheetId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.autoimgSheetsOpen(sheetId.trim());
      if (res.success) {
        setSheetName(res.name || sheetId);
        onSheetLinked?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al abrir Sheet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Credenciales OAuth">
        {oauthConfigured && savedClientIdMasked ? (
          <div className="space-y-2">
            <p className="text-[11px] text-[var(--text-muted)]">Client ID configurado:</p>
            <p className="truncate font-mono text-[10px] text-[var(--text-secondary)]">{savedClientIdMasked}</p>
            <button
              type="button"
              onClick={() => {
                setOauthConfigured(false);
                setClientSecret('');
              }}
              className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
            >
              Cambiar credenciales
            </button>
          </div>
        ) : (
          <div className="space-y-3">
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
            <button
              type="button"
              onClick={handleSaveOAuth}
              disabled={loading || !clientId.trim() || !clientSecret.trim()}
              className="w-full rounded-lg bg-[var(--text-primary)] py-2.5 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading ? 'Guardando…' : 'Guardar credenciales'}
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Cuenta Google">
        {!oauthConfigured ? (
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Guarda las credenciales OAuth antes de conectar tu cuenta.
          </p>
        ) : connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <p className="truncate text-[12px] text-[var(--text-secondary)]">{email || 'Conectado'}</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
              Cerrar sesión
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {awaitingAuth ? (
              <>
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Elige tu cuenta de Google en el navegador. Al terminar, volverás aquí automáticamente.
                </p>
                {authUrl && (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 break-all text-[11px] text-sky-400 underline-offset-2 hover:underline"
                  >
                    <ExternalLink size={12} className="shrink-0" />
                    Abrir de nuevo en el navegador
                  </a>
                )}
                {redirectUri && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                    Si Google pide URI de redirección, usa credencial tipo <strong className="font-medium">Aplicación de escritorio</strong>
                    {' '}(no Web). URI: <span className="font-mono">{redirectUri}</span>
                  </p>
                )}
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <Loader2 size={12} className="animate-spin shrink-0" />
                  Esperando autorización…
                </div>
                <button
                  type="button"
                  onClick={handleCancelAuth}
                  disabled={loading}
                  className="w-full py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] disabled:opacity-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Se abrirá Google en tu navegador para elegir la cuenta y autorizar Sheets y Drive.
                </p>
                <button
                  type="button"
                  onClick={handleStartAuth}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-medium)] py-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                  Elegir cuenta en Google
                </button>
              </>
            )}
          </div>
        )}
      </SectionCard>

      {connected && (
        <SectionCard title="Google Sheets">
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
            Pega el ID del Sheet maestro (catálogo BD_IMG).
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="ID del Sheet"
              className={`${INPUT_CLASS} flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={handleOpenSheet}
              disabled={loading || !sheetId.trim()}
              className="shrink-0 rounded-lg border border-[var(--border-medium)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
            >
              Abrir
            </button>
          </div>
          {sheetName && (
            <p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">{sheetName}</p>
          )}
        </SectionCard>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}