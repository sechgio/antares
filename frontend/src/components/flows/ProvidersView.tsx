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
  model: string;
  saving: boolean;
}

export default function ProvidersView() {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AiProviderStatus | undefined>>({});
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

  const updateForm = (p: AiProviderSpec, patch: { apiKey?: string; baseUrl?: string; model?: string }) => {
    setStatuses((s) => ({ ...s, [p.id]: undefined }));
    setForms((s) => ({
      ...s,
      [p.id]: {
        apiKey: patch.apiKey ?? s[p.id]?.apiKey ?? '',
        baseUrl: patch.baseUrl ?? s[p.id]?.baseUrl ?? p.base_url,
        model: patch.model ?? s[p.id]?.model ?? p.default_model,
        saving: false,
      },
    }));
  };

  const save = async (p: AiProviderSpec) => {
    const form = forms[p.id];
    const apiKey = form?.apiKey.trim() ?? '';
    const baseUrl = form?.baseUrl.trim() ?? p.base_url;
    const model = form?.model.trim() ?? p.default_model;
    if (p.needs_key && !apiKey && !p.has_key) {
      addToast({ message: `Introduce la clave de acceso de ${p.label}`, type: 'error' });
      return;
    }
    if (!apiKey && !baseUrl && !(p.needs_key && p.has_key)) {
      addToast({ message: 'Introduce la clave de acceso o la dirección del servicio antes de guardar.', type: 'error' });
      return;
    }
    setForms((s) => ({ ...s, [p.id]: { apiKey, baseUrl, model, saving: true } }));
    try {
      await aiProvidersApi.aiProviderSave({
        provider: p.id,
        api_key: apiKey || undefined,
        base_url: baseUrl,
        model,
      });
      setStatuses((s) => ({ ...s, [p.id]: undefined }));
      addToast({ message: `Ajustes de ${p.label} guardados y cifrados en este equipo`, type: 'success' });
      await refresh();
      setForms((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo guardar ${p.label}`), type: 'error' });
    } finally {
      setForms((s) =>
        s[p.id] ? { ...s, [p.id]: { ...s[p.id], apiKey: '', saving: false } } : s,
      );
    }
  };

  const probe = async (p: AiProviderSpec) => {
    const form = forms[p.id];
    if (form && (form.apiKey.trim() || form.baseUrl.trim() !== p.base_url || form.model.trim() !== p.default_model)) {
      addToast({ message: 'Guarda los cambios antes de probar la conexión.', type: 'error' });
      return;
    }
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
      setForms((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
      addToast({ message: `Clave y ajustes de ${p.label} eliminados de este equipo`, type: 'success' });
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
    return p.needs_key ? 'Necesita clave de acceso' : 'No configurado';
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
          1. Elige un servicio. 2. Obtén su clave y guárdala aquí. 3. Pulsa «Probar» para comprobar la conexión.
          Después podrás usarlo en el Agente o en un paso de IA. Las claves se guardan cifradas en este equipo.
          Para otro proveedor compatible, usa la tarjeta del protocolo que indique su documentación y cambia la dirección y el modelo.
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
                  {p.has_key && <div className="truncate">Clave: {p.key_masked}</div>}
                  <p className="font-sans">{p.needs_key ? 'Usa una clave de tu cuenta en este servicio. El uso puede tener un coste según tu plan.' : 'Este servicio funciona en tu equipo. Instálalo y descarga un modelo antes de probar la conexión.'}</p>
                  {p.docs && <Button className="mt-2" size="sm" variant="secondary" aria-label={`${p.needs_key ? 'Obtener clave de' : 'Instalar'} ${p.label}`} onClick={() => window.open(p.docs, '_blank')}>{p.needs_key ? 'Obtener clave de acceso' : 'Ver cómo instalar'}</Button>}
                </div>

                <div className="mt-3 space-y-2">
                  {p.needs_key && (
                    <Input
                      type="password"
                      disabled={form?.saving || probing === p.id}
                      value={form?.apiKey ?? ''}
                      onChange={(e) => updateForm(p, { apiKey: e.target.value })}
                      placeholder={p.has_key ? `Actual: ${p.key_masked}` : 'Clave de acceso (API key)'}
                      spellCheck={false}
                      aria-label={`API key ${p.label}`}
                    />
                  )}
                  {p.editable_base_url && (
                    <details open={!p.needs_key}>
                    <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">{p.needs_key ? 'Dirección del servicio (avanzado)' : 'Dirección del servicio local'}</summary>
                    <Input
                      value={form?.baseUrl ?? p.base_url}
                      disabled={form?.saving || probing === p.id}
                      onChange={(e) => updateForm(p, { baseUrl: e.target.value })}
                      placeholder={`Base URL (vacío = ${p.default_base_url})`}
                      spellCheck={false}
                      aria-label={`Base URL ${p.label}`}
                    />
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">Dirección base de la API, sin /chat/completions ni /messages. Conserva /v1 si el servicio lo indica. Vacío restaura la dirección original.</p>
                    </details>
                  )}
                  <label className="block text-xs text-[var(--text-secondary)]">
                  Modelo predeterminado
                  <Input
                    className="mt-1 w-full"
                    value={form?.model ?? p.default_model}
                    disabled={form?.saving || probing === p.id}
                    onChange={(e) => updateForm(p, { model: e.target.value })}
                    maxLength={120}
                    spellCheck={false}
                    aria-label={`Modelo ${p.label}`}
                    placeholder="Nombre exacto del modelo según el servicio"
                  />
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)]">Se usará en conversaciones nuevas y pasos de IA sin modelo propio. «Probar» consulta el listado de modelos; no genera texto.</p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={form?.saving || probing === p.id} onClick={() => void save(p)}>
                      <KeyRound size={13} className="mr-1" />
                      {p.configured ? 'Actualizar' : 'Guardar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={form?.saving || probing === p.id || (p.needs_key && !p.has_key)}
                      onClick={() => void probe(p)}
                    >
                      <PlugZap size={13} className="mr-1" />
                      Probar
                    </Button>
                    {p.configured && (
                      <Button size="sm" variant="ghost" disabled={form?.saving || probing === p.id} onClick={() => void remove(p)}>
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
