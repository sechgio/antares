import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { saveFeatureHistory } from '../../utils/history';
import './evidencia-volanteo.css';
import { MSG_NO_IMAGES, MSG_TITLE_REQUIRED } from './constants';
import { useEvidenciaSession } from './hooks/useEvidenciaSession';
import { exportEvidenciaDocument } from './utils/exportDocument';
import DualLogoPicker from './components/DualLogoPicker';
import TitleForm from './components/TitleForm';
import CuadranteRangesEditor from './components/CuadranteRangesEditor';
import ImageUploader from './components/ImageUploader';
import SheetPreview from './components/SheetPreview';
import ExportBar from './components/ExportBar';

const SIDEBAR_CLASS =
  'ev-sidebar flex flex-col border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-y-auto shrink-0';
const SIDEBAR_HEADER_CLASS = 
  'sticky top-0 z-10 flex h-[45px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/95 backdrop-blur-sm px-4 shadow-sm shrink-0';

export default function EvidenciaVolanteoApp() {
  const session = useEvidenciaSession();
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [exportFormat, setExportFormat] = useState<'pdf' | 'docx'>('pdf');
  const [logoError, setLogoError] = useState<string | null>(null);

  const handleLogoChange = useCallback((side: 'left' | 'right', file: File | null) => {
    const err = session.setLogo(side, file);
    setLogoError(err);
    return err;
  }, [session]);

  const handleExport = useCallback(async () => {
    if (!session.title.trim()) {
      addToast({ message: MSG_TITLE_REQUIRED, type: 'error' });
      return;
    }
    if (session.images.length === 0) {
      addToast({ message: MSG_NO_IMAGES, type: 'error' });
      return;
    }
    session.setIsExporting(true);
    try {
      const { filename } = await exportEvidenciaDocument(
        session.title.trim(),
        session.cuadranteRanges,
        session.images,
        session.logoLeft,
        session.logoRight,
        exportFormat,
        session.cuadranteLabel,
        session.showCuadranteLabel,
      );
      if (!filename) return;
      await saveFeatureHistory(
        'evidencia_volanteo',
        filename,
        { format: exportFormat, pages: session.totalPages, images: session.images.length },
        session.images.length,
      );
      addToast({ message: `Exportado: ${filename}`, type: 'success' });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : `Error al exportar ${exportFormat.toUpperCase()}`;
      addToast({ message, type: 'error' });
    } finally {
      session.setIsExporting(false);
    }
  }, [session, exportFormat, addToast]);

  useKeyboardShortcut('Enter', handleExport, { ctrl: true, preventDefault: true });

  const handleClearImages = useCallback(async () => {
    const ok = await confirm({
      title: 'Limpiar imágenes',
      description: '¿Eliminar todas las imágenes cargadas?',
      type: 'destructive',
      confirmLabel: 'Limpiar',
    });
    if (ok) session.clearImages();
  }, [confirm, session]);

  return (
    <div className="ev-app flex h-full overflow-hidden" data-surface="evidencia-volanteo">
      {/* Sidebar izquierdo: activos */}
      <aside className={`${SIDEBAR_CLASS} ev-sidebar-left border-r relative`}>
        <div className={SIDEBAR_HEADER_CLASS}>
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Activos del Documento</span>
        </div>

        <div className="flex flex-col gap-6 p-4">
          <DualLogoPicker
            logoLeft={session.logoLeft}
            logoRight={session.logoRight}
            onLogoChange={handleLogoChange}
            errorMessage={logoError}
          />
          <hr className="border-[var(--border-subtle)]/50" />
          <ImageUploader
            images={session.images}
            onAdd={session.addImages}
            onRemove={session.removeImage}
            onClear={handleClearImages}
          />
        </div>

        <div className="mt-auto sticky bottom-0 z-10 shrink-0 pointer-events-none">
          {/* Fondo con blur desvanecido estilo iOS */}
          <div 
            className="absolute inset-0 bg-[var(--bg-base)]/60 backdrop-blur-md pointer-events-none"
            style={{ 
              WebkitMaskImage: 'linear-gradient(to top, black 70%, transparent 100%)',
              maskImage: 'linear-gradient(to top, black 70%, transparent 100%)'
            }} 
          />
          {/* Contenido interactivo */}
          <div className="relative pointer-events-auto flex flex-col gap-3 w-full px-4 pt-8 pb-4">
            <ExportBar format={exportFormat} onFormatChange={setExportFormat} />
            <button
              type="button"
              onClick={handleExport}
              disabled={session.isExporting}
              className="flex items-center justify-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text-on-accent)] hover:opacity-90 disabled:opacity-50 transition-all shadow-sm w-full"
            >
              {session.isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Exportar documento
            </button>
          </div>
        </div>
      </aside>

      {/* Centro: vista previa */}
      <div className="ev-preview flex-1 flex flex-col min-w-0 bg-[var(--bg-elevated)] overflow-hidden">
        <div className="ev-preview-scroll flex-1 overflow-auto flex items-start justify-center px-6 pb-6 pt-2">
          <SheetPreview
            title={session.title}
            cuadrante={session.currentCuadrante}
            cuadranteLabel={session.cuadranteLabel}
            showCuadranteLabel={session.showCuadranteLabel}
            logoLeft={session.logoLeft?.objectUrl ?? null}
            logoRight={session.logoRight?.objectUrl ?? null}
            images={session.currentPageImages}
            pageNum={session.currentPageIndex + 1}
            totalPages={session.totalPages}
          />
        </div>
      </div>

      {/* Sidebar derecho: encabezado y cuadrantes */}
      <aside className={`${SIDEBAR_CLASS} ev-sidebar-right border-l relative`}>
        <div className={SIDEBAR_HEADER_CLASS}>
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Configuración del Documento</span>
        </div>
        
        <div className="flex flex-col gap-6 p-4">
          <TitleForm title={session.title} onTitleChange={session.setTitle} />
          <hr className="border-[var(--border-subtle)]/50" />
          <CuadranteRangesEditor
            ranges={session.cuadranteRanges}
            totalPages={session.totalPages}
            cuadranteLabel={session.cuadranteLabel}
            showCuadranteLabel={session.showCuadranteLabel}
            onCuadranteLabelChange={session.setCuadranteLabel}
            onShowCuadranteLabelChange={session.setShowCuadranteLabel}
            onChange={session.setCuadranteRanges}
            onAdd={session.addCuadranteRange}
          />
        </div>

        {/* Navegador de páginas - Sticky al fondo flotante */}
        <div className="mt-auto sticky bottom-0 z-10 shrink-0 pointer-events-none">
          {/* Fondo con blur desvanecido estilo iOS */}
          <div 
            className="absolute inset-0 bg-[var(--bg-base)]/60 backdrop-blur-md pointer-events-none"
            style={{ 
              WebkitMaskImage: 'linear-gradient(to top, black 70%, transparent 100%)',
              maskImage: 'linear-gradient(to top, black 70%, transparent 100%)'
            }} 
          />
          {/* Contenido interactivo */}
          <div className="relative pointer-events-auto px-4 pt-8 pb-4 flex flex-col w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Vista Previa</span>
            <span className="text-[10px] text-[var(--text-muted)] font-medium">
              {session.images.length} imagen{session.images.length !== 1 ? 'es' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--text-primary)]">
              Hoja {session.totalPages > 0 ? session.currentPageIndex + 1 : 0} <span className="text-[var(--text-muted)]">/ {session.totalPages || 0}</span>
            </span>
            {session.totalPages > 1 && (
              <div className="flex items-center gap-0.5 bg-[var(--bg-base)] rounded-md border border-[var(--border-subtle)] p-0.5 shadow-sm">
                <button
                  type="button"
                  aria-label="Hoja anterior"
                  disabled={session.currentPageIndex <= 0}
                  onClick={() => session.setCurrentPageIndex(session.currentPageIndex - 1)}
                  className="p-1 rounded hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-30 text-[var(--text-muted)] transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Hoja siguiente"
                  disabled={session.currentPageIndex >= session.totalPages - 1}
                  onClick={() => session.setCurrentPageIndex(session.currentPageIndex + 1)}
                  className="p-1 rounded hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-30 text-[var(--text-muted)] transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </aside>
    </div>
  );
}
