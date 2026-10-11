import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { sanitizeHtmlForPreview } from '../../../../shared/html-sanitizer.js';
import { api, type DesignDocument, type DesignListItem, type DesignPagePreset } from '@/api';
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
  const frameRef = useRef<HTMLIFrameElement | null>(null);

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
    })();
  }, [active, refreshList]);

  const slideCount = document?.slides?.length ?? 0;
  const currentSlide = document?.slides?.[slideIndex];

  const loadPreview = useCallback(async (doc: DesignDocument) => {
    const res = await api.designRenderHtml({ document: doc });
    setPreviewHtml(sanitizeHtmlForPreview(res.html));
    setSlideIndex(0);
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
      const res = await api.designExportPdf({ document, outputPath, overwrite: true });
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
              </div>
              <Button size="sm" onClick={() => void handleExport()} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                Exportar PDF
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <iframe
                ref={frameRef}
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
                title={`Vista previa del diseño: ${document?.name ?? ''}`}
                className="h-full min-h-[420px] w-full rounded border border-[var(--border-subtle)] bg-white"
              />
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