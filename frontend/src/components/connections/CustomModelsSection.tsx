import { useState } from 'react';
import { AlertCircle, KeyRound, Lock, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react';
import {
  aiProvidersApi,
  type AiProviderApiFormat,
  type AiProviderSpec,
  type AiProviderStatus,
} from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import { ProviderIcon } from './connectionIcons';
import { TONE_COLOR, providerStatusText, providerStatusTone } from './providerStatus';

const API_FORMATS: { value: AiProviderApiFormat; label: string }[] = [
  { value: 'openai', label: 'OpenAI compatible (Chat Completions)' },
  { value: 'anthropic', label: 'Anthropic Messages' },
];

const apiFormatLabel = (api?: string): string =>
  API_FORMATS.find((format) => format.value === api)?.label ?? 'OpenAI compatible (Chat Completions)';

interface CustomFormState {
  id: string | null;
  label: string;
  api: AiProviderApiFormat;
  baseUrl: string;
  model: string;
  apiKey: string;
  saving: boolean;
}

export default function CustomModelsSection({
  providers,
  onChanged,
}: {
  providers: AiProviderSpec[];
  onChanged: () => Promise<void>;
}) {
  const { addToast } = useToast();
  const [statuses, setStatuses] = useState<Record<string, AiProviderStatus | undefined>>({});
  const [probing, setProbing] = useState<string | null>(null);
  const [form, setForm] = useState<CustomFormState | null>(null);

  const editing = form?.id ? providers.find((p) => p.id === form.id) : undefined;

  const openCreate = () => {
    setForm({ id: null, label: '', api: 'openai', baseUrl: '', model: '', apiKey: '', saving: false });
  };

  const openEdit = (p: AiProviderSpec) => {
    setStatuses((s) => ({ ...s, [p.id]: undefined }));
    setForm({
      id: p.id,
      label: p.label,
      api: p.api === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: p.base_url,
      model: p.default_model,
      apiKey: '',
      saving: false,
    });
  };

  const save = async () => {
    if (!form) return;
    const label = form.label.trim();
    const baseUrl = form.baseUrl.trim();
    const model = form.model.trim();
    const apiKey = form.apiKey.trim();
    if (!label || !baseUrl || !model) {
      addToast({ message: 'Completa el nombre, la dirección del servicio y el modelo.', type: 'error' });
      return;
    }
    setForm({ ...form, saving: true });
    try {
      await aiProvidersApi.aiProviderCustomSave({
        ...(form.id ? { id: form.id } : {}),
        label,
        api: form.api,
        base_url: baseUrl,
        model,
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      addToast({ message: `${label} guardado y cifrado en este equipo`, type: 'success' });
      setForm(null);
      await onChanged();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo guardar ${label}`), type: 'error' });
      setForm((current) => (current ? { ...current, saving: false } : current));
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
      setStatuses((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
      if (form?.id === p.id) setForm(null);
      addToast({ message: `Clave y ajustes de ${p.label} eliminados de este equipo`, type: 'success' });
      await onChanged();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo eliminar ${p.label}`), type: 'error' });
    }
  };

  return (
    <section className="mt-8" aria-label="Modelos personalizados">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Modelos personalizados</h3>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-secondary)]">
            Añade un modelo de cualquier servicio compatible con OpenAI (Chat Completions) o Anthropic Messages.
            Queda disponible en el Agente como un proveedor más.
          </p>
        </div>
        {!form && (
          <Button size="sm" variant="primary" onClick={openCreate}>
            <Plus size={13} />
            Añadir modelo
          </Button>
        )}
      </div>

      {form && (
        <form
          className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {form.id ? 'Editar modelo personalizado' : 'Nuevo modelo personalizado'}
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Se guarda cifrado en este equipo y queda disponible en el Agente.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Nombre
              <Input
                className="mt-1.5 w-full"
                value={form.label}
                autoFocus
                maxLength={60}
                disabled={form.saving}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="Mi modelo local"
                spellCheck={false}
                aria-label="Nombre del modelo personalizado"
              />
            </label>
            <div className="text-xs font-medium text-[var(--text-secondary)]">
              <span>Formato de API</span>
              <ThemedSelect
                className="mt-1.5 w-full"
                aria-label="Formato de API del modelo personalizado"
                value={form.api}
                disabled={form.saving}
                options={API_FORMATS}
                onChange={(value) => setForm({
                  ...form,
                  api: value === 'anthropic' ? 'anthropic' : 'openai',
                })}
              />
            </div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Dirección base
              <Input
                className="mt-1.5 w-full"
                value={form.baseUrl}
                disabled={form.saving}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://api.ejemplo.com/v1"
                spellCheck={false}
                aria-label="Dirección base del modelo personalizado"
              />
              <span className="mt-1 block text-[11px] font-normal text-[var(--text-muted)]">
                Sin /chat/completions ni /messages. Conserva /v1 si el servicio lo indica.
              </span>
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Modelo
              <Input
                className="mt-1.5 w-full"
                value={form.model}
                disabled={form.saving}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
                maxLength={128}
                placeholder="Nombre exacto del modelo"
                spellCheck={false}
                aria-label="Modelo personalizado"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)] sm:col-span-2">
              Clave de acceso (opcional)
              <Input
                className="mt-1.5 w-full"
                type="password"
                value={form.apiKey}
                disabled={form.saving}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder={editing?.has_key ? `Guardada: ${editing.key_masked}` : 'Clave del servicio'}
                spellCheck={false}
                aria-label="Clave del modelo personalizado"
              />
              <span className="mt-1 block text-[11px] font-normal text-[var(--text-muted)]">
                {editing?.has_key
                  ? 'Déjala vacía para conservar la clave guardada.'
                  : 'Déjala vacía si el servicio local no pide clave.'} Se guarda cifrada en este equipo.
              </span>
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={form.saving} onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={form.saving}>
              <KeyRound size={13} />
              {form.saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Guardar modelo'}
            </Button>
          </div>
        </form>
      )}

      {providers.length > 0 && (
        <ul className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {providers.map((p, index) => {
            const st = statuses[p.id];
            const busy = probing === p.id;
            const tone = providerStatusTone(p, st);
            return (
              <li
                key={p.id}
                aria-label={p.label}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${index ? 'border-t border-[var(--border-subtle)]' : ''}`}
              >
                <ProviderIcon providerId={p.id} label={p.label} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{p.label}</span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                      {providerStatusText(p, st)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)]">
                    <span className="truncate font-mono text-[var(--text-primary)]">{p.default_model}</span>
                    <span aria-hidden>·</span>
                    <span>{apiFormatLabel(p.api)}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate font-mono">{p.base_url}</span>
                    {p.has_key && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Lock size={10} />
                          {p.key_masked}
                        </span>
                      </>
                    )}
                  </div>
                  {st && !st.reachable && st.error && (
                    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--accent-red)]">
                      <AlertCircle size={12} className="mt-px shrink-0" />
                      <span className="break-words">{st.error}</span>
                    </p>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Probar conexión"
                    aria-label={`Probar ${p.label}`}
                    disabled={busy || (p.needs_key && !p.has_key)}
                    onClick={() => void probe(p)}
                  >
                    <PlugZap size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Editar"
                    aria-label={`Editar ${p.label}`}
                    disabled={busy}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    className="hover:text-[var(--accent-red)]"
                    size="sm"
                    variant="ghost"
                    title="Eliminar"
                    aria-label={`Eliminar ${p.label}`}
                    disabled={busy}
                    onClick={() => void remove(p)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!providers.length && !form && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Todavía no hay modelos personalizados. Añade uno para usarlo en el Agente.
        </p>
      )}
    </section>
  );
}
