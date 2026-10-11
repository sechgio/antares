import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronRight, ExternalLink, KeyRound, Lock, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';
import { aiProvidersApi, type AiProviderSpec, type AiProviderStatus } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { ProviderIcon } from './connectionIcons';

const TONE_COLOR = {
  ok: 'var(--accent-green)',
  warn: 'var(--accent-yellow)',
  off: 'var(--text-secondary)',
} as const;

function StatusBadge({ tone, children }: { tone: keyof typeof TONE_COLOR; children: string }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
      style={{
        color,
        borderColor: tone === 'off' ? 'var(--border-subtle)' : `color-mix(in srgb, ${color} 40%, transparent)`,
        background: tone === 'off' ? 'transparent' : `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

const STEPS = ['Elige un servicio', 'Obtén su clave y guárdala aquí', 'Pulsa «Probar» para comprobar la conexión'];

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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Proveedores IA</h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Después podrás usarlo en el Agente o en un paso de IA.
        </p>
        <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mb-5 mt-3 flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={12} className="shrink-0 text-[var(--accent-green)]" />
            Las claves se guardan cifradas en este equipo.
          </span>
          <span>
            Para otro proveedor compatible, usa la tarjeta del protocolo que indique su documentación y cambia la dirección y el modelo.
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {providers.map((p) => {
            const form = forms[p.id];
            const st = statuses[p.id];
            const busy = form?.saving || probing === p.id;
            return (
              <section
                key={p.id}
                aria-label={p.label}
                className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-colors duration-150 hover:border-[var(--border-medium)]"
              >
                <div className="flex items-start gap-3 p-4 pb-3">
                  <ProviderIcon providerId={p.id} label={p.label} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{p.label}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{p.description}</div>
                  </div>
                  <StatusBadge tone={statusTone(p)}>{statusText(p)}</StatusBadge>
                </div>

                <div className="mx-4 flex items-start justify-between gap-3 rounded-lg bg-[var(--bg-input)] px-3 py-2.5">
                  <div className="min-w-0 space-y-1 text-[11px] text-[var(--text-secondary)]">
                    {p.has_key && (
                      <div className="flex items-center gap-1.5 font-mono text-[var(--text-primary)]">
                        <Lock size={11} className="shrink-0 text-[var(--text-secondary)]" />
                        <span className="truncate">Clave: {p.key_masked}</span>
                      </div>
                    )}
                    <p className="text-pretty">{p.needs_key ? 'Usa una clave de tu cuenta en este servicio. El uso puede tener un coste según tu plan.' : 'Este servicio funciona en tu equipo. Instálalo y descarga un modelo antes de probar la conexión.'}</p>
                  </div>
                  {p.docs && (
                    <Button
                      className="shrink-0"
                      size="sm"
                      variant="secondary"
                      aria-label={`${p.needs_key ? 'Obtener clave de' : 'Instalar'} ${p.label}`}
                      onClick={() => window.open(p.docs, '_blank')}
                    >
                      {p.needs_key ? 'Obtener clave de acceso' : 'Ver cómo instalar'}
                      <ExternalLink size={12} />
                    </Button>
                  )}
                </div>

                <div className="space-y-3 p-4">
                  {p.needs_key && (
                    <label className="block text-xs font-medium text-[var(--text-secondary)]">
                      Clave de acceso
                      <Input
                        className="mt-1.5 w-full"
                        type="password"
                        disabled={busy}
                        value={form?.apiKey ?? ''}
                        onChange={(e) => updateForm(p, { apiKey: e.target.value })}
                        placeholder={p.has_key ? `Actual: ${p.key_masked}` : 'Clave de acceso (API key)'}
                        spellCheck={false}
                        aria-label={`API key ${p.label}`}
                      />
                    </label>
                  )}
                  <label className="block text-xs font-medium text-[var(--text-secondary)]">
                    Modelo predeterminado
                    <Input
                      className="mt-1.5 w-full"
                      value={form?.model ?? p.default_model}
                      disabled={busy}
                      onChange={(e) => updateForm(p, { model: e.target.value })}
                      maxLength={120}
                      spellCheck={false}
                      aria-label={`Modelo ${p.label}`}
                      placeholder="Nombre exacto del modelo según el servicio"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-[var(--text-muted)]">
                      Se usará en conversaciones nuevas y pasos de IA sin modelo propio. «Probar» consulta el listado de modelos; no genera texto.
                    </span>
                  </label>
                  {p.editable_base_url && (
                    <details open={!p.needs_key} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={13} className="transition-transform duration-150 group-open:rotate-90" />
                        {p.needs_key ? 'Dirección del servicio (avanzado)' : 'Dirección del servicio local'}
                      </summary>
                      <div className="mt-1.5 pl-[17px]">
                        <Input
                          className="w-full"
                          value={form?.baseUrl ?? p.base_url}
                          disabled={busy}
                          onChange={(e) => updateForm(p, { baseUrl: e.target.value })}
                          placeholder={`Base URL (vacío = ${p.default_base_url})`}
                          spellCheck={false}
                          aria-label={`Base URL ${p.label}`}
                        />
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">Dirección base de la API, sin /chat/completions ni /messages. Conserva /v1 si el servicio lo indica. Vacío restaura la dirección original.</p>
                      </div>
                    </details>
                  )}
                </div>

                {st && !st.reachable && st.error && (
                  <p role="alert" className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-red)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-red)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--accent-red)]">
                    <AlertCircle size={12} className="mt-px shrink-0" />
                    <span className="break-words">{st.error}</span>
                  </p>
                )}

                <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
                  <Button size="sm" disabled={busy} onClick={() => void save(p)}>
                    <KeyRound size={13} />
                    {p.configured ? 'Actualizar' : 'Guardar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || (p.needs_key && !p.has_key)}
                    onClick={() => void probe(p)}
                  >
                    <PlugZap size={13} />
                    Probar
                  </Button>
                  {p.configured && (
                    <Button className="ml-auto hover:text-[var(--accent-red)]" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(p)}>
                      <Trash2 size={13} />
                      Eliminar
                    </Button>
                  )}
                </div>
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
