import { useCallback, useEffect, useState } from 'react';
import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { aiProvidersApi, type AiProviderSpec, type AiProviderStatus } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' }) {
  const color =
    tone === 'ok' ? '#34d399' : tone === 'warn' ? '#f59e0b' : 'var(--text-secondary)';
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}

interface FormState {
  apiKey: string;
  baseUrl: string;
  saving: boolean;
}

export default function ProvidersView() {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AiProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await aiProvidersApi.aiProvidersList();
      setProviders(res.providers);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar los proveedores IA'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (p: AiProviderSpec) => {
    const form = forms[p.id];
    const apiKey = form?.apiKey.trim() ?? '';
    const baseUrl = form?.baseUrl.trim() ?? '';
    if (p.needs_key && !apiKey && !p.has_key) {
      addToast({ message: `Introduce la API key de ${p.label}`, type: 'error' });
      return;
    }
    if (!apiKey && !baseUrl && !(p.needs_key && p.has_key)) {
      addToast({ message: 'Nada que guardar — introduce la clave o la base URL', type: 'error' });
      return;
    }
    setForms((s) => ({ ...s, [p.id]: { apiKey, baseUrl, saving: true } }));
    try {
      await aiProvidersApi.aiProviderSave({
        provider: p.id,
        api_key: apiKey || undefined,
        base_url: baseUrl || undefined,
      });
      addToast({ message: `Ajustes de ${p.label} guardados en el vault cifrado`, type: 'success' });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo guardar ${p.label}`), type: 'error' });
    } finally {
      setForms((s) =>
        s[p.id] ? { ...s, [p.id]: { ...s[p.id], apiKey: '', saving: false } } : s,
      );
    }
  };

  const probe = async (p: AiProviderSpec) => {
    setProbing(p.id);
    try {
      const res = await aiProvidersApi.aiProviderStatus(p.id);
      setStatuses((s) => ({ ...s, [p.id]: res.provider }));
      if (res.provider.reachable) {
        addToast({
          message: `${p.label} responde${res.provider.models_count != null ? ` · modelos: ${res.provider.models_count}` : ''}`,
          type: 'success',
        });
      } else {
        addToast({ message: `${p.label}: ${res.provider.error ?? 'sin respuesta'}`, type: 'error' });
      }
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo comprobar ${p.label}`), type: 'error' });
    } finally {
      setProbing(null);
    }
  };

  const remove = async (p: AiProviderSpec) => {
    try {
      await aiProvidersApi.aiProviderDelete(p.id);
      addToast({ message: `Clave y ajustes de ${p.label} eliminados del vault`, type: 'success' });
      setStatuses((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
      await refresh();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo eliminar ${p.label}`), type: 'error' });
    }
  };

  const statusText = (p: AiProviderSpec): string => {
    const st = statuses[p.id];
    if (st?.reachable) {
      return st.models_count != null ? `Disponible · ${st.models_count} modelos` : 'Disponible';
    }
    if (p.has_key || (p.configured && !p.needs_key)) return 'Configurado';
    return p.needs_key ? 'Necesita API key' : 'No configurado';
  };

  const statusTone = (p: AiProviderSpec): 'ok' | 'warn' | 'off' => {
    if (statuses[p.id]?.reachable) return 'ok';
    if (p.has_key || (p.configured && !p.needs_key)) return 'warn';
    return 'off';
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        Cargando proveedores…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Proveedores IA</h2>
        <p className="mb-5 mt-1 text-xs text-[var(--text-secondary)]">
          Tus propias claves (BYOK): la clave solo va al vault cifrado de este equipo y nunca
          vuelve a la interfaz — solo se ve la máscara. «Probar» consulta el endpoint de modelos.
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {providers.map((p) => {
            const form = forms[p.id];
            const st = statuses[p.id];
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
                  <div className="truncate">Base URL: {p.base_url}</div>
                  {p.has_key && <div className="truncate">Clave: {p.key_masked}</div>}
                  {p.docs && <div className="mt-0.5 truncate">Claves: {p.docs}</div>}
                </div>

                <div className="mt-3 space-y-2">
                  {p.needs_key && (
                    <Input
                      type="password"
                      value={form?.apiKey ?? ''}
                      onChange={(e) =>
                        setForms((s) => ({
                          ...s,
                          [p.id]: {
                            apiKey: e.target.value,
                            baseUrl: form?.baseUrl ?? '',
                            saving: false,
                          },
                        }))
                      }
                      placeholder={p.has_key ? `Actual: ${p.key_masked}` : 'API key'}
                      spellCheck={false}
                      aria-label={`API key ${p.label}`}
                    />
                  )}
                  {p.editable_base_url && (
                    <Input
                      value={form?.baseUrl ?? ''}
                      onChange={(e) =>
                        setForms((s) => ({
                          ...s,
                          [p.id]: {
                            apiKey: form?.apiKey ?? '',
                            baseUrl: e.target.value,
                            saving: false,
                          },
                        }))
                      }
                      placeholder={`Base URL (vacío = ${p.default_base_url})`}
                      spellCheck={false}
                      aria-label={`Base URL ${p.label}`}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={form?.saving} onClick={() => void save(p)}>
                      <KeyRound size={13} className="mr-1" />
                      {p.configured ? 'Actualizar' : 'Guardar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={probing === p.id || (p.needs_key && !p.has_key)}
                      onClick={() => void probe(p)}
                    >
                      <PlugZap size={13} className="mr-1" />
                      Probar
                    </Button>
                    {p.configured && (
                      <Button size="sm" variant="ghost" onClick={() => void remove(p)}>
                        <Trash2 size={13} className="mr-1" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </div>

                {st && !st.reachable && st.error && (
                  <p className="mt-2 truncate text-[11px] text-[var(--danger,#f87171)]">{st.error}</p>
                )}
              </section>
            );
          })}
        </div>

        {!providers.length && (
          <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
            No hay proveedores en el catálogo.
          </p>
        )}
      </div>
    </div>
  );
}
