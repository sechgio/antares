import '../technical-reports/technical-reports.css';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ChevronLeft, ChevronRight, Database, Download, Eye, FilePlus2, Files, PenLine, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { saveFeatureHistory } from '../../utils/history';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl, fichasTecnicasApi } from './api';
import { normalizeFicha, type FichaTecnica, type FichaTecnicaListItem } from './types';

const DRAFT_KEY = 'current_ficha_draft';
type MobileTab = 'db' | 'preview' | 'form';

function formatIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  if (message.includes('IPC method not allowed') || message.includes('Método desconocido')) {
    return `${message} Cierra TODAS las ventanas de Antares y vuelve a abrir la app (Vite HMR no recarga el preload IPC).`;
  }
  return message || fallback;
}

function readDraft(): { selectedId: string | null; formData: FichaTecnica | null } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { selectedId: null, formData: null };
    const parsed = JSON.parse(raw) as { selectedId?: string | null; formData?: FichaTecnica | null };
    const formData = parsed.formData ? normalizeFicha(parsed.formData) : null;
    if (formData && !formData.id) {
      return { selectedId: null, formData: null };
    }
    return {
      selectedId: parsed.selectedId ?? formData?.id ?? null,
      formData,
    };
  } catch {
    return { selectedId: null, formData: null };
  }
}

export default function FichasTecnicasApp() {
  const { addToast } = useToast();
  const dialog = useDialog();
  const draft = useMemo(() => readDraft(), []);
  const [fichas, setFichas] = useState<FichaTecnicaListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(draft.selectedId);
  const [formData, setFormData] = useState<FichaTecnica | null>(draft.formData);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview');
  const importInputRef = useRef<HTMLInputElement>(null);

  const hasChanges = dirtyCount > 0;

  const patchForm = useCallback((ficha: FichaTecnica) => {
    setFormData(ficha);
    setDirtyCount((c) => c + 1);
  }, []);

  const currentIndex = useMemo(
    () => fichas.findIndex((ficha) => ficha.id === selectedId),
    [fichas, selectedId],
  );

  const applyFicha = useCallback((ficha: FichaTecnica | null) => {
    setSelectedId(ficha?.id ?? null);
    setFormData(ficha);
    setDirtyCount(0);
  }, []);

  const clearSelection = useCallback(() => {
    applyFicha(null);
  }, [applyFicha]);

  const busyCountRef = useRef(0);
  const selectGenRef = useRef(0);

  const withBusy = useCallback(
    async (fn: () => Promise<void>, fallbackError: string) => {
      busyCountRef.current += 1;
      setBusy(true);
      try {
        await fn();
      } catch (error) {
        addToast({ message: formatIpcError(error, fallbackError), type: 'error' });
      } finally {
        busyCountRef.current = Math.max(0, busyCountRef.current - 1);
        if (busyCountRef.current === 0) setBusy(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ selectedId, formData }));
    } catch {
      // ignore storage failures
    }
  }, [selectedId, formData]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === '.') {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (focusMode) setMobileTab('preview');
  }, [focusMode]);

  const loadFichas = useCallback(async () => {
    const result = await fichasTecnicasApi.list(true);
    setFichas(result.fichas || []);
  }, []);

  useEffect(() => {
    void withBusy(loadFichas, 'No se pudieron cargar las fichas');
  }, [loadFichas, withBusy]);

  const selectFicha = useCallback(
    async (id: string) => {
      if (hasChanges) {
        const proceed = await dialog.confirm({
          title: 'Cambios sin guardar',
          description: '¿Guardar cambios antes de continuar?',
          confirmLabel: 'Guardar y continuar',
          cancelLabel: 'Seguir editando',
        });
        if (!proceed) return;
        if (formData) {
          try {
            const saved = normalizeFicha(await fichasTecnicasApi.update(formData.id, formData));
            applyFicha(saved);
            await loadFichas();
          } catch (error) {
            addToast({ message: formatIpcError(error, 'No se pudo guardar'), type: 'error' });
            return;
          }
        }
      }
      const gen = ++selectGenRef.current;
      await withBusy(async () => {
        const ficha = normalizeFicha(await fichasTecnicasApi.get(id));
        if (gen !== selectGenRef.current) return;
        applyFicha(ficha);
        setMobileTab('preview');
      }, 'No se pudo abrir la ficha');
    },
    [addToast, applyFicha, dialog, formData, hasChanges, loadFichas, withBusy],
  );

  const createFicha = useCallback(async () => {
    await withBusy(async () => {
      const ficha = normalizeFicha(await fichasTecnicasApi.create());
      await loadFichas();
      applyFicha(ficha);
      setMobileTab('preview');
      addToast({ message: 'Ficha creada', type: 'success' });
    }, 'No se pudo crear la ficha');
  }, [addToast, applyFicha, loadFichas, withBusy]);

  const saveFicha = useCallback(async () => {
    if (!formData) return;
    await withBusy(async () => {
      const saved = normalizeFicha(await fichasTecnicasApi.update(formData.id, formData));
      applyFicha(saved);
      await loadFichas();
      addToast({ message: 'Ficha guardada', type: 'success' });
    }, 'No se pudo guardar');
  }, [addToast, applyFicha, formData, loadFichas, withBusy]);

  const deleteFicha = useCallback(async () => {
    if (!selectedId) return;
    const confirmed = await dialog.confirm({
      title: 'Eliminar ficha',
      description: `Se eliminará ${selectedId} de la base local.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    await withBusy(async () => {
      await fichasTecnicasApi.delete(selectedId);
      clearSelection();
      await loadFichas();
      addToast({ message: 'Ficha eliminada', type: 'success' });
    }, 'No se pudo eliminar');
  }, [addToast, clearSelection, dialog, loadFichas, selectedId, withBusy]);

  const clearFichas = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: 'Eliminar todas las fichas',
      description: 'Esta acción vacía la base local de forma permanente.',
      confirmLabel: 'Eliminar todo',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    await withBusy(async () => {
      await fichasTecnicasApi.clear();
      setFichas([]);
      clearSelection();
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      addToast({ message: 'Base de fichas limpiada', type: 'success' });
    }, 'No se pudo limpiar la base');
  }, [addToast, clearSelection, dialog, withBusy]);

  const importFile = useCallback(
    async (file: File) => {
      await withBusy(async () => {
        const content = await fileToBase64(file);
        const result = await fichasTecnicasApi.importFile(file.name, content);
        clearSelection();
        await loadFichas();
        addToast({ message: `${result.imported_count} fichas importadas`, type: 'success' });
      }, 'No se pudo importar el archivo');
    },
    [addToast, clearSelection, loadFichas, withBusy],
  );

  const changeLogo = useCallback(
    async (file: File | null) => {
      if (!file) {
        setLogoLeft(null);
        return;
      }
      try {
        setLogoLeft(await fileToDataUrl(file));
      } catch (error) {
        addToast({ message: formatIpcError(error, 'No se pudo cargar el logo'), type: 'error' });
      }
    },
    [addToast],
  );

  const exportCurrent = useCallback(async () => {
    await withBusy(async () => {
      if (!formData) {
        const rendered = await fichasTecnicasApi.renderHtml({
          template: true,
          logo_left: logoLeft,
        });
        const pdf = await fichasTecnicasApi.htmlToPdf({
          html: rendered.html,
          filename: rendered.filename,
          return_base64: true,
        });
        if (!pdf.pdf_base64) throw new Error('No se recibió el contenido del PDF generado.');
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
        await saveFeatureHistory('ficha_tecnica', pdf.filename, { type: 'plantilla' });
        addToast({ message: 'Plantilla PDF generada', type: 'success' });
        return;
      }

      const fichaForRender = hasChanges
        ? normalizeFicha(await fichasTecnicasApi.update(formData.id, formData))
        : formData;
      if (hasChanges) {
        applyFicha(fichaForRender);
        await loadFichas();
      }
      const rendered = await fichasTecnicasApi.renderHtml({
        id: fichaForRender.id,
        ficha: fichaForRender,
        logo_left: logoLeft,
      });
      const pdf = await fichasTecnicasApi.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        return_base64: true,
      });
      if (!pdf.pdf_base64) throw new Error('No se recibió el contenido del PDF generado.');
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      await saveFeatureHistory('ficha_tecnica', pdf.filename, {
        type: 'individual',
        fichaId: fichaForRender.id,
      });
      addToast({
        message: hasChanges ? 'Ficha guardada y PDF generado' : 'PDF generado',
        type: 'success',
      });
    }, 'No se pudo generar el PDF');
  }, [addToast, applyFicha, formData, hasChanges, loadFichas, logoLeft, withBusy]);

  const exportConsolidated = useCallback(async () => {
    if (fichas.length === 0) return;
    const confirmed = await dialog.confirm({
      title: '¿Generar PDF consolidado?',
      description: `Se generará un PDF con ${fichas.length} fichas.`,
      confirmLabel: 'Generar PDF',
      cancelLabel: 'Cancelar',
    });
    if (!confirmed) return;
    await withBusy(async () => {
      const rendered = await fichasTecnicasApi.renderConsolidatedHtml({ logo_left: logoLeft });
      const pdf = await fichasTecnicasApi.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        return_base64: true,
      });
      if (!pdf.pdf_base64) throw new Error('No se recibió el contenido del PDF generado.');
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      await saveFeatureHistory(
        'ficha_tecnica',
        pdf.filename,
        { type: 'consolidado', count: rendered.count },
        rendered.count,
      );
      addToast({ message: `PDF consolidado generado (${rendered.count})`, type: 'success' });
    }, 'No se pudo generar el consolidado');
  }, [addToast, dialog, fichas.length, logoLeft, withBusy]);

  const goRelative = (direction: -1 | 1) => {
    const next = fichas[currentIndex + direction];
    if (next) void selectFicha(next.id);
  };

  return (
    <div className="tr-app ft-app" data-surface="fichas-tecnicas">
      <header className="tr-header">
        <h1>FICHAS TÉCNICAS</h1>
        <div className="tr-header-toolbar">
          <div className="tr-header-actions">
            <button
              type="button"
              className="tr-secondary"
              disabled={busy}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload size={16} />
              Importar
            </button>
            <WithHoverTooltip label="Recargar" placement="bottom">
              <button
                type="button"
                className="tr-secondary tr-icon-button"
                disabled={busy}
                onClick={() => void withBusy(loadFichas, 'No se pudieron cargar las fichas')}
              >
                <RefreshCw size={16} />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Eliminar todas" placement="bottom">
              <button
                type="button"
                className="tr-danger tr-icon-button"
                disabled={busy || fichas.length === 0}
                onClick={() => void clearFichas()}
              >
                <Trash2 size={16} />
              </button>
            </WithHoverTooltip>
            <button type="button" className="tr-secondary" onClick={() => void createFicha()} disabled={busy}>
              <FilePlus2 size={16} />
              Nuevo
            </button>
            <WithHoverTooltip
              label={formData ? 'Generar PDF de la ficha actual' : 'Generar PDF de la plantilla en blanco'}
              placement="bottom"
            >
              <button
                type="button"
                className="tr-primary"
                onClick={() => void exportCurrent()}
                disabled={busy}
              >
                <Download size={16} />
                {formData ? 'PDF' : 'Plantilla PDF'}
              </button>
            </WithHoverTooltip>
            <button
              type="button"
              className="tr-secondary"
              onClick={() => void exportConsolidated()}
              disabled={fichas.length === 0 || busy}
            >
              <Files size={16} />
              Consolidado
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          className="hidden"
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </header>

      <nav className="tr-mobile-tabs" role="tablist" aria-label="Vista de fichas técnicas">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'db'}
          className={`tr-mobile-tab${mobileTab === 'db' ? ' is-active' : ''}`}
          onClick={() => setMobileTab('db')}
        >
          <Database size={14} />
          <span>Fichas</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'preview'}
          className={`tr-mobile-tab${mobileTab === 'preview' ? ' is-active' : ''}`}
          onClick={() => setMobileTab('preview')}
        >
          <Eye size={14} />
          <span>Vista previa</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'form'}
          className={`tr-mobile-tab${mobileTab === 'form' ? ' is-active' : ''}`}
          onClick={() => setMobileTab('form')}
        >
          <PenLine size={14} />
          <span>Editar</span>
        </button>
      </nav>

      <div
        className="tr-workspace"
        data-mobile-tab={mobileTab}
        style={focusMode ? { gridTemplateColumns: '0px 1fr 0px' } : undefined}
      >
        {!focusMode && (
          <DatabasePanel fichas={fichas} selectedId={selectedId} onSelect={(id) => void selectFicha(id)} />
        )}
        <PreviewPanel ficha={formData} logoLeft={logoLeft} />
        {!focusMode && (
          <FormPanel
            ficha={formData}
            hasChanges={hasChanges}
            busy={busy}
            logoLeft={logoLeft}
            onChange={patchForm}
            onSave={() => void saveFicha()}
            onDelete={() => void deleteFicha()}
            onLogoChange={(file) => void changeLogo(file)}
          />
        )}
      </div>

      {focusMode && (
        <>
          <WithHoverTooltip label="Anterior (modo focus)" placement="bottom">
            <button
              type="button"
              className="fixed left-3 top-1/2 z-50 -translate-y-1/2 rounded-full bg-[var(--accent-red)] p-3 text-[var(--text-on-accent)] shadow-lg disabled:opacity-40"
              disabled={currentIndex <= 0 || busy}
              onClick={() => goRelative(-1)}
            >
              <ChevronLeft size={28} />
            </button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Siguiente (modo focus)" placement="bottom">
            <button
              type="button"
              className="fixed right-3 top-1/2 z-50 -translate-y-1/2 rounded-full bg-[var(--accent-red)] p-3 text-[var(--text-on-accent)] shadow-lg disabled:opacity-40"
              disabled={currentIndex < 0 || currentIndex >= fichas.length - 1 || busy}
              onClick={() => goRelative(1)}
            >
              <ChevronRight size={28} />
            </button>
          </WithHoverTooltip>
        </>
      )}
    </div>
  );
}
