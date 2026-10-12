import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { sanitizeHtmlForPreview } from '../../../../shared/html-sanitizer.js';
import {
  api,
  type DesignDocument,
  type DesignFinding,
  type DesignListItem,
  type DesignMemoryResponse,
  type DesignPagePreset,
} from '@/api';
import { aiProvidersApi, type AiProviderSpec } from '@/api/aiProvidersApi';
import Button from '@/components/ui/Button';
import ThemedSelect from '@/components/ui/ThemedSelect';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/hooks/useToast';
import { errorMessage } from '@/utils/errors';
import { askPdfSavePath } from '@/utils/deliverRenderedDocument';
import { saveFeatureHistory } from '@/utils/history';

const PAGE_PRESET_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '16x9', label: '16:9 · Presentación' },
  { value: '16x10', label: '16:10 · Presentación' },
  { value: '4x3', label: '4:3 · Presentación' },
  { value: 'a4', label: 'A4 vertical' },
  { value: 'a4-landscape', label: 'A4 apaisado' },
];

interface ProviderOption {
  value: string;
  label: string;
}

export default function DesignApp({ active = true }: { active?: boolean }) {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [preset, setPreset] = useState<DesignPagePreset>('16x9');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<DesignDocument | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [items, setItems] = useState<DesignListItem[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [findings, setFindings] = useState<DesignFinding[]>([]);
  const [withNotes, setWithNotes] = useState(false);
  const [memory, setMemory] = useState<DesignMemoryResponse['memory']>({ version: 1, notes: [] });
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const refreshMemory = useCallback(async () => {
    try {
      setMemory((await api.designMemoryGet()).memory);
    } catch {
      // La memoria accesoria no debe bloquear el panel.
    }
  }, []);

  const handleMemoryAdd = useCallback(async () => {
    const text = memoryDraft.trim();
    if (!text) return;
    try {
      setMemory((await api.designMemoryAdd(text)).memory);
      setMemoryDraft('');
    } catch (err) {
      setError(errorMessage(err, 'No se pudo guardar la preferencia'));
    }
  }, [memoryDraft]);

  const handleMemoryDelete = useCallback(async (id: string) => {
    try {
      setMemory((await api.designMemoryDelete(id)).memory);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo borrar la preferencia'));
    }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await api.designList();
      setItems(res.designs ?? []);
    } catch {
      // La lista es accesoria: si falla, el panel sigue siendo usable.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void (async () => {
      try {
        const res = await aiProvidersApi.aiProvidersList();
        const configured = (res.providers ?? []).filter((p) => p.configured);
        setProviders(configured);
        setProvider((current) => current || configured[0]?.provider || '');
        setModel((current) => current || configured[0]?.default_model || '');
      } catch (err) {
        setError(errorMessage(err, 'No se pudieron cargar los proveedores'));
      }
      void refreshList();
      void refreshMemory();
    })();
  }, [active, refreshList, refreshMemory]);

  const slideCount = document?.slides?.length ?? 0;
  const currentSlide = document?.slides?.[slideIndex];

  const loadPreview = useCallback(async (doc: DesignDocument) => {
    const res = await api.designRenderHtml({ document: doc });
    setPreviewHtml(sanitizeHtmlForPreview(res.html));
    setSlideIndex(0);
    // El control de calidad corre siempre, no bajo demanda: es barato y es
    // donde se atrapan los defectos que la vista previa no enseña a ojo
    // (texto que se sale del área segura, bloques que se solapan).
    try {
      const report = await api.designPreflight({ document: doc });
      setFindings(report.findings ?? []);
    } catch {
      setFindings([]);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!provider) {
      setError('Configura un proveedor con clave en Ajustes antes de generar.');
      return;
    }
    if (!prompt.trim()) {
      setError('Describe qué quieres presentar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.designGenerate({ prompt: prompt.trim(), provider, model: model || undefined, page_preset: preset });
      setDocument(res.document);
      await loadPreview(res.document);
      void refreshList();
      addToast({ message: `Diseño generado: ${res.document.slides.length} diapositivas`, type: 'success' });
    } catch (err) {
      setError(errorMessage(err, 'Error al generar el diseño'));
    } finally {
      setBusy(false);
    }
  }, [addToast, loadPreview, model, preset, prompt, provider, refreshList]);

  const handleOpen = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await api.designGet(id);
        setDocument(res.document);
        await loadPreview(res.document);
      } catch (err) {
        setError(errorMessage(err, 'No se pudo abrir el diseño'));
      }
    },
    [loadPreview],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.designDelete(id);
        if (document?.id === id) {
          setDocument(null);
          setPreviewHtml('');
        }
        void refreshList();
      } catch (err) {
        setError(errorMessage(err, 'No se pudo eliminar el diseño'));
      }
    },
    [document?.id, refreshList],
  );

  const handleExport = useCallback(async () => {
    if (!document) return;
    setExporting(true);
    try {
      const outputPath = await askPdfSavePath(`${document.name || 'diseno'}.pdf`, 'Guardar presentación');
      if (!outputPath) return;
      const res = await api.designExportPdf({ document, outputPath, overwrite: true, notes: withNotes });
      await saveFeatureHistory('design', res.filename, {
        slides: document.slides.length,
        page: document.page?.preset,
      }, document.slides.length);
      addToast({ message: `Exportado: ${res.filename}`, type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'Error al exportar el PDF'), type: 'error' });
    } finally {
      setExporting(false);
    }
  }, [addToast, document]);

  const providerOptions = useMemo<ProviderOption[]>(
    () => providers.map((p) => ({ value: p.provider, label: p.label })),
    [providers],
  );

  const presetOptions = useMemo(() => [...PAGE_PRESET_OPTIONS], []);

  const selectedProvider = providers.find((p) => p.provider === provider);

  const handleReload = useCallback(() => {
    if (!document) return;
    void loadPreview(document);
  }, [document, loadPreview]);

  return (
    <div data-surface="design" className="flex h-full min-h-0 gap-4 p-4 text-[var(--text-primary)]">
      {/* Columna de control */}
      <div className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto">
        <div>
          <h1 className="text-lg font-semibold">Design</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Genera una presentación con el modelo que tú configures.
          </p>
        </div>

        {providers.length === 0 && (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-muted)]">
            No hay ningún proveedor con clave guardada. Añade una en Ajustes → IA.
          </p>
        )}

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-muted)]">Proveedor</span>
          <ThemedSelect value={provider} onChange={setProvider} options={providerOptions} placeholder="Sin proveedor" />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-muted)]">Modelo</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={selectedProvider?.default_model ?? 'nombre del modelo'}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-primary)]"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-muted)]">Formato</span>
          <ThemedSelect value={preset} onChange={(v) => setPreset(v as DesignPagePreset)} options={presetOptions} />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-muted)]">Qué quieres presentar</span>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            placeholder="Ej.: resultados del trimestre Q3 para el comité de dirección. Tres cifras clave, un plan de acción y cierre con una recomendación."
          />
        </label>

        <Button onClick={handleGenerate} disabled={busy} className="w-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {busy ? 'Generando…' : 'Generar diseño'}
        </Button>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Memoria de diseño: preferencias que el modelo respeta en cada
            generación. Equivale a memory_write de Claude Design. */}
        <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-3">
          <button
            onClick={() => setMemoryOpen((open) => !open)}
            aria-expanded={memoryOpen}
            className="flex items-center justify-between text-xs text-[var(--text-muted)]"
          >
            <span>Preferencias de diseño</span>
            <span>{memory.notes.length > 0 ? `${memory.notes.length}` : ''}</span>
          </button>
          {memoryOpen && (
            <>
              <div className="flex gap-1">
                <input
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleMemoryAdd();
                  }}
                  placeholder="p.ej. nada de degradados"
                  className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs"
                />
                <Button variant="ghost" size="sm" onClick={() => void handleMemoryAdd()} disabled={!memoryDraft.trim()}>
                  Añadir
                </Button>
              </div>
              <ul className="flex flex-col gap-1">
                {memory.notes.map((note) => (
                  <li key={note.id} className="group flex items-center gap-1 text-xs">
                    <span className="flex-1 text-[var(--text-muted)]">{note.text}</span>
                    <button
                      onClick={() => void handleMemoryDelete(note.id)}
                      aria-label={`Borrar preferencia: ${note.text}`}
                      className="rounded-md p-1 text-[var(--text-muted)] opacity-0 hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
                {memory.notes.length === 0 && (
                  <li className="text-xs text-[var(--text-muted)]">
                    Aún no hay preferencias. Se aplican a todas las generaciones.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-3">
            <span className="text-xs text-[var(--text-muted)]">Diseños guardados</span>
            {items.map((item) => (
              <div key={item.id} className="group flex items-center gap-1">
                <button
                  onClick={() => void handleOpen(item.id)}
                  className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                >
                  {item.name}
                  <span className="ml-1 text-[var(--text-muted)]">
                    · {item.slideCount} dia.
                  </span>
                </button>
                <button
                  onClick={() => void handleDelete(item.id)}
                  aria-label={`Eliminar ${item.name}`}
                  className="rounded-md p-1 text-[var(--text-muted)] opacity-0 hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vista previa */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        {previewHtml ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSlideIndex((i) => Math.max(0, i - 1))} disabled={slideIndex === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-[var(--text-muted)]">
                  {slideIndex + 1} / {slideCount}
                  {currentSlide?.title ? ` · ${currentSlide.title}` : ''}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSlideIndex((i) => Math.min(slideCount - 1, i + 1))}
                  disabled={slideIndex >= slideCount - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReload} aria-label="Recargar vista previa">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {findings.length > 0 && (
                  <span
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                    style={{
                      color: findings.some((f) => f.severity === 'error') ? '#F87171' : 'var(--text-muted)',
                      background: 'var(--bg-base)',
                    }}
                    title={findings.map((f) => `· ${f.message}`).join('\n')}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {findings.length}
                  </span>
                )}
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]" title="Incluir las notas del ponente bajo cada diapositiva">
                  <input
                    type="checkbox"
                    checked={withNotes}
                    onChange={(e) => setWithNotes(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Notas
                </label>
                <Button size="sm" onClick={() => void handleExport()} disabled={exporting}>
                  {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                  Exportar PDF
                </Button>
              </div>
            </div>
            {findings.length > 0 && (
              <ul className="max-h-24 overflow-y-auto border-b border-[var(--border-subtle)] px-3 py-2 text-xs">
                {findings.slice(0, 8).map((finding, index) => (
                  <li key={`${finding.kind}-${finding.slide}-${index}`} className="flex gap-2 py-0.5">
                    <span style={{ color: finding.severity === 'error' ? '#F87171' : 'var(--text-muted)' }}>
                      {finding.slide > 0 ? `Dia. ${finding.slide}` : 'Tema'}
                    </span>
                    <span className="text-[var(--text-muted)]">{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <iframe
                ref={frameRef}
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
                title={`Vista previa del diseño: ${document?.name ?? ''}`}
                className="h-full min-h-[420px] w-full rounded border border-[var(--border-subtle)] bg-white"
              />
            </div>
            {/* Tira de diapositivas: el salto rápido que en Claude Design
                resuelve el canvas remoto y aquí se resuelve con el IR. */}
            <div className="flex gap-1 overflow-x-auto border-t border-[var(--border-subtle)] px-3 py-2">
              {(document?.slides ?? []).map((slide, index) => {
                const slideIssues = findings.filter((f) => f.slide === index + 1 && f.severity === 'error').length;
                return (
                  <button
                    key={slide.id || index}
                    onClick={() => setSlideIndex(index)}
                    aria-current={index === slideIndex}
                    aria-label={`Diapositiva ${index + 1}${slide.title ? `: ${slide.title}` : ''}`}
                    className="flex h-9 min-w-[72px] shrink-0 items-center justify-center gap-1 rounded border px-2 text-[11px]"
                    style={{
                      borderColor: index === slideIndex ? 'var(--accent-primary)' : 'var(--border-subtle)',
                      background: index === slideIndex ? 'var(--bg-elevated)' : 'transparent',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {slideIssues > 0 && <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden />}
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
            Escribe una descripción y genera tu primer diseño.
          </div>
        )}
      </div>
    </div>
  );
}