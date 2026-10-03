import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Link2, Plug, Unplug } from 'lucide-react';
import { onNotify } from '../../api';
import { connectionsApi, type ConnectionProviderSpec } from '../../api/connectionsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import McpServersView from './McpServersView';

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' }) {
  const color =
    tone === 'ok' ? '#34d399' : tone === 'warn' ? '#f59e0b' : 'var(--text-secondary)';
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}

function statusText(p: ConnectionProviderSpec): string {
  if (p.connected) return p.account ? `Conectado · ${p.account}` : 'Conectado';
  if (p.configured) return 'Listo para conectar';
  return 'Sin credenciales';
}

function statusTone(p: ConnectionProviderSpec): 'ok' | 'warn' | 'off' {
  if (p.connected) return 'ok';
  if (p.configured) return 'warn';
  return 'off';
}

interface CredFormState {
  clientId: string;
  clientSecret: string;
  saving: boolean;
}

export default function ConnectionsView() {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<ConnectionProviderSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [credForm, setCredForm] = useState<Record<string, CredFormState>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await connectionsApi.connectionsProviders();
      setProviders(res.providers);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las conexiones'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
    const off = onNotify((method) => {
      if (method === 'connections.changed') void refresh();
    });
    return off;
  }, [refresh]);

  const saveCreds = async (p: ConnectionProviderSpec) => {
    const form = credForm[p.id];
    if (!form || !form.clientId.trim()) {
      addToast({ message: 'Introduce el Client ID de tu app', type: 'error' });
      return;
    }
    setCredForm((s) => ({ ...s, [p.id]: { ...form, saving: true } }));
    try {
      await connectionsApi.connectionsOauthConfigSave({
        provider: p.id,
        client_id: form.clientId.trim(),
        client_secret: form.clientSecret.trim() || undefined,
      });
      addToast({ message: `Credenciales de ${p.label} guardadas cifradas`, type: 'success' });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron guardar las credenciales'), type: 'error' });
    } finally {
      setCredForm((s) =>
        s[p.id] ? { ...s, [p.id]: { ...form, saving: false } } : s,
      );
    }
  };

  const connect = async (p: ConnectionProviderSpec) => {
    setConnecting(p.id);
    try {
      await connectionsApi.connectionsConnect(p.id);
      addToast({
        message: `Se abrió el navegador para autorizar ${p.label}. Completa el acceso y vuelve aquí.`,
        type: 'success',
      });
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo iniciar la conexión con ${p.label}`), type: 'error' });
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async (p: ConnectionProviderSpec) => {
    try {
      await connectionsApi.connectionsDisconnect(p.id);
      addToast({ message: `${p.label} desconectado`, type: 'success' });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo desconectar ${p.label}`), type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        Cargando conexiones…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Conexiones</h2>
        <p className="mb-5 mt-1 text-xs text-[var(--text-secondary)]">
          Autoriza apps externas vía OAuth. Los tokens se guardan cifrados y los usa el nodo HTTP de
          tus flujos con la opción «Conexión». Los Client ID/Secret son de tus propias apps (BYOK).
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {providers.map((p) => {
            const form = credForm[p.id];
            const showForm = form !== undefined || !p.configured;
            return (
              <section
                key={p.id}
                className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-input)] text-sm font-bold uppercase text-[var(--text-secondary)]">
                      {p.label.slice(0, 2)}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{p.label}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{p.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                    <StatusDot tone={statusTone(p)} />
                    {statusText(p)}
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-[var(--bg-input)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                  <div>Redirect URI a registrar en tu app:</div>
                  <div className="text-[var(--text-primary)]">{p.redirect_hint}</div>
                  {p.docs && <div className="mt-0.5 truncate">Panel: {p.docs}</div>}
                </div>

                {showForm ? (
                  <div className="mt-3 space-y-2">
                    <Input
                      value={form?.clientId ?? ''}
                      onChange={(e) =>
                        setCredForm((s) => ({
                          ...s,
                          [p.id]: {
                            clientId: e.target.value,
                            clientSecret: form?.clientSecret ?? '',
                            saving: false,
                          },
                        }))
                      }
                      placeholder={p.configured ? `Client ID actual: ${p.client_id_masked ?? ''}` : 'Client ID'}
                      spellCheck={false}
                      aria-label={`Client ID de ${p.label}`}
                    />
                    {p.requires_client_secret && (
                      <Input
                        type="password"
                        value={form?.clientSecret ?? ''}
                        onChange={(e) =>
                          setCredForm((s) => ({
                            ...s,
                            [p.id]: {
                              clientId: form?.clientId ?? '',
                              clientSecret: e.target.value,
                              saving: false,
                            },
                          }))
                        }
                        placeholder="Client Secret"
                        spellCheck={false}
                        aria-label={`Client Secret de ${p.label}`}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={form?.saving}
                        onClick={() => void saveCreds(p)}
                      >
                        <KeyRound size={13} className="mr-1" />
                        {p.configured ? 'Actualizar credenciales' : 'Guardar credenciales'}
                      </Button>
                      {p.configured && !p.connected && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={connecting === p.id}
                          onClick={() => void connect(p)}
                        >
                          <Link2 size={13} className="mr-1" />
                          Conectar
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    {p.connected ? (
                      <Button size="sm" variant="secondary" onClick={() => void disconnect(p)}>
                        <Unplug size={13} className="mr-1" />
                        Desconectar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={connecting === p.id}
                        onClick={() => void connect(p)}
                      >
                        <Plug size={13} className="mr-1" />
                        Conectar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCredForm((s) => ({
                          ...s,
                          [p.id]: { clientId: '', clientSecret: '', saving: false },
                        }))
                      }
                    >
                      <KeyRound size={13} className="mr-1" />
                      Credenciales
                    </Button>
                  </div>
                )}

                {p.connected && p.scope && (
                  <p className="mt-2 truncate text-[11px] text-[var(--text-secondary)]">
                    Permisos: {p.scope}
                  </p>
                )}
              </section>
            );
          })}
        </div>

        {!providers.length && (
          <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
            No hay proveedores configurados en el catálogo.
          </p>
        )}

        <McpServersView />
      </div>
    </div>
  );
}
