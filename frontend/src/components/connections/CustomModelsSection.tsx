import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Lock, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react';
import {
  aiProvidersApi,
  type AiProviderApiFormat,
  type AiProviderSpec,
  type AiProviderStatus,
} from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import { SegmentedControl } from '../ui/SegmentedControl';
import { TONE_COLOR, providerStatusText, providerStatusTone } from './providerStatus';

const API_FORMATS: { value: AiProviderApiFormat; label: string }[] = [
  { value: 'openai', label: 'OpenAI compatible (Chat Completions)' },
  { value: 'anthropic', label: 'Anthropic Messages' },
];

interface Suggestion {
  model: string;
  label?: string;
}

interface Preset {
  id: string;
  label: string;
  api: AiProviderApiFormat;
  baseUrl: string;
  modelPlaceholder: string;
  keyPlaceholder: string;
  keyless?: boolean;
  suggestions: Suggestion[];
}

const PRESETS: Preset[] = [
  {
    id: 'anthropic', label: 'Anthropic', api: 'anthropic', baseUrl: 'https://api.anthropic.com',
    modelPlaceholder: 'claude-sonnet-5-5', keyPlaceholder: 'sk-ant-...',
    suggestions: [
      { model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { model: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', api: 'openai', baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-5.5', keyPlaceholder: 'sk-...',
    suggestions: [
      { model: 'gpt-5.5', label: 'GPT-5.5' },
      { model: 'gpt-5.4', label: 'GPT-5.4' },
      { model: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { model: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    ],
  },
  {
    id: 'openrouter', label: 'OpenRouter', api: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    modelPlaceholder: 'qwen/qwen3-coder', keyPlaceholder: 'sk-or-...',
    suggestions: [
      { model: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { model: 'openai/gpt-5.5', label: 'GPT-5.5' },
      { model: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
      { model: 'qwen/qwen3-coder', label: 'Qwen3 Coder' },
    ],
  },
  {
    id: 'ollama', label: 'Ollama', api: 'openai', baseUrl: 'http://localhost:11434/v1',
    modelPlaceholder: 'qwen3:32b', keyPlaceholder: 'Clave opcional del servidor', keyless: true,
    suggestions: [],
  },
  {
    id: 'custom', label: 'Otro proveedor', api: 'openai', baseUrl: '',
    modelPlaceholder: 'id-del-modelo', keyPlaceholder: 'Clave de tu proveedor',
    suggestions: [],
  },
];

const CUSTOM_PRESET = PRESETS[PRESETS.length - 1];

type Auth = 'stored' | 'key' | 'none';
type Vision = 'auto' | 'yes' | 'no';

const VISION_OPTIONS: { value: Vision; label: string }[] = [
  { value: 'auto', label: 'Detectar por el nombre del modelo' },
  { value: 'yes', label: 'Sí, acepta capturas e imágenes' },
  { value: 'no', label: 'No, solo texto' },
];
const MIN_CONTEXT = 1024;
const MAX_CONTEXT = 10_000_000;

interface EditorState {
  id: string | null;
  preset: string;
  api: AiProviderApiFormat;
  baseUrl: string;
  model: string;
  displayName: string;
  auth: Auth;
  apiKey: string;
  vision: Vision;
  contextWindow: string;
  advanced: boolean;
  submitted: boolean;
  saving: boolean;
  error: string | null;
}

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

function presetFor(api: string | undefined, baseUrl: string): Preset {
  return PRESETS.find((p) => p.id !== 'custom' && p.api === api && normalizeUrl(p.baseUrl) === normalizeUrl(baseUrl))
    ?? CUSTOM_PRESET;
}

const apiFormatLabel = (api?: string): string =>
  API_FORMATS.find((format) => format.value === api)?.label ?? 'Formato no válido';

function ModelCombobox({
  id,
  value,
  suggestions,
  placeholder,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  suggestions: Suggestion[];
  placeholder: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const items = useMemo(() => {
    const term = value.trim().toLowerCase();
    if (!term) return suggestions;
    return suggestions.filter((s) => s.model.toLowerCase().includes(term) || s.label?.toLowerCase().includes(term));
  }, [suggestions, value]);
  const showList = open && items.length > 0 && !(items.length === 1 && items[0].model === value.trim());

  useEffect(() => setHighlighted(0), [value, suggestions]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && showList) {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!items.length) return;
      setHighlighted((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && showList && items[highlighted]) {
      event.preventDefault();
      onChange(items[highlighted].model);
      setOpen(false);
    }
  };

  return (
    <div className="mt-1.5">
      <Input
        id={id}
        className={`w-full font-mono ${invalid ? 'border-[var(--accent-red)]' : ''}`}
        value={value}
        disabled={disabled}
        maxLength={120}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-label="Modelo personalizado"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList ? `${listId}-${highlighted}` : undefined}
        aria-invalid={invalid || undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Sugerencias de modelo"
          className="custom-scrollbar mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1"
        >
          {items.map((item, index) => (
            <div
              key={item.model}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={item.model === value.trim()}
              onMouseDown={(event) => { event.preventDefault(); onChange(item.model); setOpen(false); }}
              onMouseEnter={() => setHighlighted(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-xs ${index === highlighted ? 'bg-[var(--bg-input)]' : ''}`}
            >
              <span className="truncate font-mono text-[var(--text-primary)]">{item.model}</span>
              {item.label && <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{item.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomModelEditor({
  initial,
  editing,
  onClose,
  onSaved,
}: {
  initial: EditorState;
  editing?: AiProviderSpec;
  onClose: () => void;
  onSaved: (label: string) => Promise<void>;
}) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState(initial);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  useFocusTrap(dialogRef, true);

  const preset = PRESETS.find((p) => p.id === form.preset) ?? CUSTOM_PRESET;
  const isCustom = preset.id === 'custom';
  const patch = (next: Partial<EditorState>) => setForm((current) => ({ ...current, ...next, error: null }));

  useEffect(() => {
    if (!editing || (editing.needs_key && !editing.has_key)) return;
    let cancelled = false;
    void aiProvidersApi.aiProviderStatus(editing.id)
      .then((res) => { if (!cancelled) setLiveModels(res.provider.models ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [editing]);

  const suggestions = useMemo(() => {
    const known = new Map(preset.suggestions.map((s) => [s.model, s]));
    const live = liveModels.map((model) => known.get(model) ?? { model });
    return [...live, ...preset.suggestions.filter((s) => !liveModels.includes(s.model))];
  }, [liveModels, preset]);

  const choosePreset = (id: string) => {
    const next = PRESETS.find((p) => p.id === id) ?? CUSTOM_PRESET;
    const keepAuth = form.id !== null || form.apiKey.trim() !== '';
    patch({
      preset: next.id,
      api: next.api,
      baseUrl: next.baseUrl,
      advanced: form.advanced || next.id === 'custom',
      ...(keepAuth ? {} : { auth: next.keyless ? 'none' : 'key' }),
    });
  };

  const model = form.model.trim();
  const baseUrl = form.baseUrl.trim();
  const apiKey = form.apiKey.trim();
  const contextText = form.contextWindow.replace(/[\s.,_]/g, '');
  const contextWindow = contextText ? Number(contextText) : null;
  const errors = {
    model: !model ? 'Introduce el ID del modelo.' : null,
    baseUrl: !baseUrl ? 'Introduce la dirección base del servicio.' : null,
    apiKey: form.auth === 'key' && !apiKey ? 'Introduce una clave o elige otra forma de autenticación.' : null,
    contextWindow: contextWindow !== null && (!Number.isInteger(contextWindow) || contextWindow < MIN_CONTEXT || contextWindow > MAX_CONTEXT)
      ? `Indica un número entero de tokens entre ${MIN_CONTEXT} y ${MAX_CONTEXT.toLocaleString('es')}.`
      : null,
  };
  const show = (field: keyof typeof errors) => (form.submitted ? errors[field] : null);

  const save = async () => {
    if (form.saving) return;
    if (errors.model || errors.baseUrl || errors.apiKey || errors.contextWindow) {
      setForm((current) => ({ ...current, submitted: true, advanced: current.advanced || !!errors.baseUrl || !!errors.contextWindow }));
      return;
    }
    const label = form.displayName.trim() || model;
    setForm((current) => ({ ...current, submitted: true, saving: true, error: null }));
    try {
      await aiProvidersApi.aiProviderCustomSave({
        ...(form.id ? { id: form.id } : {}),
        label,
        api: form.api,
        base_url: baseUrl,
        model,
        ...(form.auth === 'key' ? { api_key: apiKey } : {}),
        ...(form.auth === 'none' && editing?.has_key ? { remove_key: true } : {}),
        ...(form.vision !== initial.vision ? { vision: form.vision === 'auto' ? null : form.vision === 'yes' } : {}),
        ...(form.contextWindow.trim() !== initial.contextWindow ? { context_window: contextWindow } : {}),
      });
      await onSaved(label);
    } catch (err) {
      setForm((current) => ({ ...current, saving: false, error: errorMessage(err, 'No se pudo guardar el modelo personalizado') }));
    }
  };

  const authOptions: { value: Auth; label: string }[] = [
    ...(editing?.has_key ? [{ value: 'stored' as const, label: 'Clave guardada' }] : []),
    { value: 'key', label: editing?.has_key ? 'Clave nueva' : 'Clave de API' },
    { value: 'none', label: 'Sin clave' },
  ];

  const fieldLabel = 'block text-xs font-medium text-[var(--text-secondary)]';
  const helper = 'mt-1 block text-[11px] font-normal text-[var(--text-muted)]';
  const fieldError = (message: string | null) =>
    message ? <span role="alert" className="mt-1 block text-[11px] font-normal text-[var(--accent-red)]">{message}</span> : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 88%, transparent)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !form.saving) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        tabIndex={-1}
        className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-base)] shadow-xl animate-scale-in"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !form.saving) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="border-b border-[var(--border-subtle)] px-5 py-4">
          <h3 id={`${baseId}-title`} className="text-sm font-semibold text-[var(--text-primary)]">
            {form.id ? 'Editar modelo personalizado' : 'Añadir modelo personalizado'}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Configura un proveedor y un modelo en este equipo.</p>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          >
          <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <span className={fieldLabel}>Proveedor</span>
              <ThemedSelect
                className="mt-1.5 w-full"
                aria-label="Proveedor del modelo personalizado"
                value={preset.id}
                disabled={form.saving}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                onChange={choosePreset}
              />
              {!isCustom && (
                <span className={`${helper} break-all`}>Endpoint: {baseUrl || 'Sin definir'}</span>
              )}
            </div>

            {isCustom && (
              <>
                <label className={fieldLabel}>
                  Dirección base
                  <Input
                    className={`mt-1.5 w-full ${show('baseUrl') ? 'border-[var(--accent-red)]' : ''}`}
                    value={form.baseUrl}
                    disabled={form.saving}
                    onChange={(event) => patch({ baseUrl: event.target.value })}
                    placeholder="https://api.proveedor.com/v1"
                    spellCheck={false}
                    aria-label="Dirección base del modelo personalizado"
                  />
                  {fieldError(show('baseUrl'))}
                  <span className={helper}>Sin /chat/completions ni /messages. Conserva /v1 si el servicio lo indica.</span>
                </label>
                <div className={fieldLabel}>
                  <span>Formato de API</span>
                  <ThemedSelect
                    className="mt-1.5 w-full"
                    aria-label="Formato de API del modelo personalizado"
                    value={form.api}
                    disabled={form.saving}
                    options={API_FORMATS}
                    onChange={(value) => patch({ api: value === 'anthropic' ? 'anthropic' : 'openai' })}
                  />
                </div>
              </>
            )}

            <div>
              <span className={fieldLabel}>Autenticación</span>
              <SegmentedControl
                className="mt-1.5 flex gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5 [&>button]:text-[11px]"
                aria-label="Autenticación del modelo personalizado"
                options={authOptions}
                value={form.auth}
                disabled={form.saving}
                onChange={(value) => patch({ auth: value, apiKey: value === 'key' ? form.apiKey : '' })}
              />
              {form.auth === 'key' && (
                <>
                  <Input
                    className={`mt-2 w-full ${show('apiKey') ? 'border-[var(--accent-red)]' : ''}`}
                    type="password"
                    value={form.apiKey}
                    disabled={form.saving}
                    onChange={(event) => patch({ apiKey: event.target.value })}
                    placeholder={preset.keyPlaceholder}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Clave del modelo personalizado"
                  />
                  {fieldError(show('apiKey'))}
                </>
              )}
              <span className={helper}>
                {form.auth === 'stored'
                  ? `Se conserva la clave guardada (${editing?.key_masked ?? '••••'}).`
                  : form.auth === 'none'
                    ? editing?.has_key
                      ? 'Al guardar se eliminará la clave guardada.'
                      : 'Para servidores locales o pasarelas que no piden clave.'
                    : 'Se guarda cifrada en este equipo y solo se envía al servicio configurado.'}
              </span>
            </div>

            <div>
              <label className={fieldLabel} htmlFor={`${baseId}-model`}>Modelo</label>
              <ModelCombobox
                id={`${baseId}-model`}
                value={form.model}
                suggestions={suggestions}
                placeholder={`Busca o escribe un ID, p. ej. ${preset.modelPlaceholder}`}
                disabled={form.saving}
                invalid={!!show('model')}
                onChange={(value) => patch({ model: value })}
              />
              {fieldError(show('model'))}
              <span className={helper}>Usa cualquier ID de modelo. Las sugerencias no se verifican con tu cuenta.</span>
            </div>

            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="px-0 text-xs text-[var(--text-secondary)] hover:bg-transparent hover:text-[var(--text-primary)]"
                aria-expanded={form.advanced}
                aria-controls={`${baseId}-advanced`}
                disabled={form.saving}
                onClick={() => patch({ advanced: !form.advanced })}
              >
                {form.advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Opciones avanzadas
              </Button>
              {form.advanced && (
                <div id={`${baseId}-advanced`} className="mt-2 space-y-4">
                  <label className={fieldLabel}>
                    Nombre visible (opcional)
                    <Input
                      className="mt-1.5 w-full"
                      value={form.displayName}
                      maxLength={60}
                      disabled={form.saving}
                      onChange={(event) => patch({ displayName: event.target.value })}
                      placeholder="Cómo aparece en el selector de modelos"
                      spellCheck={false}
                      aria-label="Nombre del modelo personalizado"
                    />
                  </label>
                  {!isCustom && (
                    <>
                      <label className={fieldLabel}>
                        Dirección base
                        <Input
                          className={`mt-1.5 w-full ${show('baseUrl') ? 'border-[var(--accent-red)]' : ''}`}
                          value={form.baseUrl}
                          disabled={form.saving}
                          onChange={(event) => patch({ baseUrl: event.target.value })}
                          spellCheck={false}
                          aria-label="Dirección base del modelo personalizado"
                        />
                        {fieldError(show('baseUrl'))}
                      </label>
                      <div className={fieldLabel}>
                        <span>Formato de API</span>
                        <ThemedSelect
                          className="mt-1.5 w-full"
                          aria-label="Formato de API del modelo personalizado"
                          value={form.api}
                          disabled={form.saving}
                          options={API_FORMATS}
                          onChange={(value) => patch({ api: value === 'anthropic' ? 'anthropic' : 'openai' })}
                        />
                      </div>
                    </>
                  )}
                  <div className={fieldLabel}>
                    <span>Imágenes en el agente</span>
                    <ThemedSelect
                      className="mt-1.5 w-full"
                      aria-label="Si el modelo acepta imágenes"
                      value={form.vision}
                      disabled={form.saving}
                      options={VISION_OPTIONS}
                      onChange={(value) => patch({ vision: value === 'yes' || value === 'no' ? value : 'auto' })}
                    />
                    <span className={helper}>El agente envía sus capturas de pantalla como imagen solo a modelos con visión.</span>
                  </div>
                  <label className={fieldLabel}>
                    Ventana de contexto (tokens, opcional)
                    <Input
                      className={`mt-1.5 w-full ${show('contextWindow') ? 'border-[var(--accent-red)]' : ''}`}
                      value={form.contextWindow}
                      inputMode="numeric"
                      disabled={form.saving}
                      onChange={(event) => patch({ contextWindow: event.target.value })}
                      placeholder="128000"
                      spellCheck={false}
                      aria-label="Ventana de contexto del modelo personalizado"
                    />
                    <span className={helper}>Ajústala en modelos locales pequeños para que el agente resuma la conversación antes de desbordarla.</span>
                    {fieldError(show('contextWindow'))}
                  </label>
                </div>
              )}
            </div>

            {form.error && (
              <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-red)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-red)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--accent-red)]">
                <AlertCircle size={12} className="mt-px shrink-0" />
                <span className="break-words">{form.error}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            <Button type="button" size="sm" variant="secondary" disabled={form.saving} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={form.saving}>
              {form.saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Añadir modelo'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CustomModelsSection({
  providers,
  onChanged,
}: {
  providers: AiProviderSpec[];
  onChanged: () => Promise<void>;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [statuses, setStatuses] = useState<Record<string, AiProviderStatus | undefined>>({});
  const [probing, setProbing] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const editing = editor?.id ? providers.find((p) => p.id === editor.id) : undefined;

  const openCreate = () => {
    const preset = PRESETS[0];
    setEditor({
      id: null, preset: preset.id, api: preset.api, baseUrl: preset.baseUrl, model: '', displayName: '',
      auth: 'key', apiKey: '', vision: 'auto', contextWindow: '', advanced: false, submitted: false, saving: false, error: null,
    });
  };

  const openEdit = (p: AiProviderSpec) => {
    const api: AiProviderApiFormat = p.api === 'anthropic' ? 'anthropic' : 'openai';
    setStatuses((s) => ({ ...s, [p.id]: undefined }));
    setEditor({
      id: p.id,
      preset: presetFor(api, p.base_url).id,
      api,
      baseUrl: p.base_url,
      model: p.default_model,
      displayName: p.label === p.default_model ? '' : p.label,
      auth: p.has_key ? 'stored' : 'none',
      apiKey: '',
      vision: p.capabilities?.vision === undefined ? 'auto' : p.capabilities.vision ? 'yes' : 'no',
      contextWindow: p.capabilities?.context_window ? String(p.capabilities.context_window) : '',
      advanced: false,
      submitted: false,
      saving: false,
      error: null,
    });
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
    const ok = await confirm({
      title: 'Eliminar modelo personalizado',
      description: p.invalid
        ? `¿Eliminar la configuración ilegible ${p.id} de este equipo?`
        : `¿Eliminar ${p.label} de este equipo? También se borrará su clave guardada.`,
      confirmLabel: 'Eliminar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await aiProvidersApi.aiProviderDelete(p.id);
      setStatuses((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
      if (editor?.id === p.id) setEditor(null);
      addToast({
        message: p.invalid
          ? `Modelo no válido ${p.id} eliminado de este equipo`
          : `Clave y ajustes de ${p.label} eliminados de este equipo`,
        type: 'success',
      });
      await onChanged();
    } catch (err) {
      addToast({ message: errorMessage(err, `No se pudo eliminar ${p.label}`), type: 'error' });
    }
  };

  const rowAction = 'h-7 gap-1 px-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

  return (
    <section className="mt-8" aria-label="Modelos personalizados">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Modelos personalizados · {providers.length}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-secondary)]">
            Usa modelos con tus propias claves. Las claves se guardan cifradas en este equipo y aparecen en el selector de modelos del Agente.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={openCreate}>
          <Plus size={13} />
          Añadir modelo
        </Button>
      </div>

      {providers.length > 0 ? (
        <ul className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {providers.map((p, index) => {
            const st = statuses[p.id];
            const busy = probing === p.id;
            const tone = providerStatusTone(p, st);
            const name = p.invalid ? p.id : p.label;
            return (
              <li
                key={p.id}
                aria-label={p.label}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${index ? 'border-t border-[var(--border-subtle)]' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{p.label}</span>
                    {p.invalid ? (
                      <span
                        className="text-[11px] font-medium text-[var(--accent-red)]"
                        title="Esta configuración está incompleta o no es válida y no aparece en el selector de modelos."
                      >
                        No válido
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                        {providerStatusText(p, st)}
                      </span>
                    )}
                  </div>
                  {p.invalid ? (
                    <p className="mt-0.5 break-words text-[11px] text-[var(--text-secondary)]">
                      No se pudo leer su configuración guardada ({p.id}). Elimínalo y vuelve a crearlo.
                    </p>
                  ) : (
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
                  )}
                  {st && !st.reachable && st.error && (
                    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--accent-red)]">
                      <AlertCircle size={12} className="mt-px shrink-0" />
                      <span className="break-words">{st.error}</span>
                    </p>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  {!p.invalid && (
                    <>
                      <Button
                        className={rowAction}
                        size="sm"
                        variant="ghost"
                        aria-label={`Probar ${p.label}`}
                        disabled={busy || (p.needs_key && !p.has_key)}
                        onClick={() => void probe(p)}
                      >
                        <PlugZap size={13} />
                        {busy ? 'Probando…' : 'Probar'}
                      </Button>
                      <Button
                        className={rowAction}
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar ${p.label}`}
                        disabled={busy}
                        onClick={() => openEdit(p)}
                      >
                        <Pencil size={13} />
                        Editar
                      </Button>
                    </>
                  )}
                  <Button
                    className={`${rowAction} hover:text-[var(--accent-red)]`}
                    size="sm"
                    variant="ghost"
                    aria-label={`Eliminar ${name}`}
                    disabled={busy}
                    onClick={() => void remove(p)}
                  >
                    <Trash2 size={13} />
                    Eliminar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          Todavía no hay modelos personalizados. Añade uno para usar tus propias claves en el Agente.
        </p>
      )}

      {editor && (
        <CustomModelEditor
          key={editor.id ?? 'new'}
          initial={editor}
          editing={editing}
          onClose={() => setEditor(null)}
          onSaved={async (label) => {
            addToast({ message: `${label} guardado y cifrado en este equipo`, type: 'success' });
            setEditor(null);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
