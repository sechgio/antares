import { useCallback, useMemo, useState } from 'react';
import { FileDown, AlertTriangle } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { api } from '../../api';

async function saveToHistory(label: string, details: Record<string, unknown>, count = 1) {
  try {
    await api.historySave({
      run_type: 'panel_aviso_corte',
      files: [label],
      options: details,
      formato: label,
      patron: '',
      calidad: 0,
      resize: null,
      ok_count: count,
      err_count: 0,
    });
  } catch {
    // Silently ignore history save errors so main flow is never blocked
  }
}
import { usePanelSession } from './hooks/usePanelSession';
import { exportPanelDocument } from './utils/exportPdf';
import { MSG_CUADRANTE_REQUIRED, MSG_NO_PANELS } from './constants';
import HeaderForm from './components/HeaderForm';
import LogoPicker from './components/LogoPicker';
import ImageUploader from './components/ImageUploader';
import ExcelImporter from './components/ExcelImporter';
import MatchRuleEditor from './components/MatchRuleEditor';
import AddressColumnSelector from './components/AddressColumnSelector';
import SummaryPanel from './components/SummaryPanel';
import SheetPreview from './components/SheetPreview';
import ExportBar from './components/ExportBar';
import './panel-styles.css';

export default function PanelAvisoCorteApp() {
  const session = usePanelSession();
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [exportFormat, setExportFormat] = useState<'pdf' | 'docx'>('pdf');

  const imagesMap = useMemo(() => {
    const map = new Map<string, string>();
    session.images.forEach((img) => map.set(img.file.name, img.objectUrl));
    return map;
  }, [session.images]);

  const totalPages = session.previewPanels.length;
  const currentPanel = session.previewPanels[session.currentPageIndex] || null;

  const handleExport = useCallback(async () => {
    if (!session.previewPanels.length) {
      addToast({ message: MSG_NO_PANELS, type: 'error' });
      return;
    }
    if (!session.excelSource && !session.headerForm.cuadrante.trim()) {
      addToast({ message: MSG_CUADRANTE_REQUIRED, type: 'error' });
      return;
    }
    const fileMap = new Map<string, File>(session.images.map((i) => [i.file.name, i.file]));
    session.setIsExporting(true);
    try {
      const { filename } = await exportPanelDocument(
        session.previewPanels,
        null,
        session.logoRight?.file ?? null,
        fileMap,
        exportFormat,
      );
      await saveToHistory(filename, { format: exportFormat, panels: session.previewPanels.length }, session.previewPanels.length);
      addToast({ message: `Exportado: ${filename}`, type: 'success' });
    } catch (e: any) {
      addToast({ message: e?.message || `Error al exportar ${exportFormat.toUpperCase()}`, type: 'error' });
    } finally {
      session.setIsExporting(false);
    }
  }, [session, exportFormat, addToast]);

  useKeyboardShortcut('Enter', handleExport, { ctrl: true, preventDefault: true });

  const handleClearImages = useCallback(async () => {
    const ok = await confirm({
      title: 'Limpiar imágenes',
      description: '¿Estás seguro de que deseas eliminar todas las imágenes cargadas?',
      type: 'destructive',
      confirmLabel: 'Limpiar',
    });
    if (ok) session.clearImages();
  }, [confirm, session]);

  const logoCenterUrl = session.logoRight?.objectUrl ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Left: Configuration ─── */}
      <div className="w-[380px] min-w-[340px] flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          {/* Datos del aviso */}
          <HeaderForm
            value={session.headerForm}
            onChange={session.setHeaderForm}
            disabled={!!session.excelSource}
          />
          <LogoPicker
            right={session.logoRight}
            onRight={session.setLogoRight}
          />

          <hr className="border-[var(--border-subtle)]" />

          {/* Imágenes y Excel */}
          <ImageUploader
            images={session.images}
            onAdd={session.addImages}
            onRemove={session.removeImage}
            onClear={handleClearImages}
          />
          <ExcelImporter source={session.excelSource} onSource={session.setExcelSource} />
          {session.excelSource && (
            <>
              <MatchRuleEditor
                rule={session.matchRule}
                columns={session.excelSource.columns}
                onChange={session.setMatchRule}
              />
              <AddressColumnSelector
                value={session.addressColumn}
                columns={session.excelSource.columns}
                onChange={session.setAddressColumn}
              />
            </>
          )}

          {/* Resumen */}
          {session.matchResult && (
            <>
              <hr className="border-[var(--border-subtle)]" />
              <SummaryPanel
                result={session.matchResult}
                exportMode={session.exportMode}
                onExportModeChange={session.setExportMode}
              />
            </>
          )}
        </div>

        {/* Errors */}
        {session.errors.length > 0 && (
          <div className="mt-auto px-4 py-2 border-t border-[var(--border-subtle)] bg-red-500/5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5 flex-1">
                {session.errors.map((err, i) => (
                  <span key={i} className="text-[11px] text-red-500">{err}</span>
                ))}
                <button className="text-[11px] text-[var(--text-muted)] self-start hover:underline" onClick={session.clearErrors}>Descartar</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Right: Preview + Export ─── */}
      <div className="flex-1 flex flex-col bg-[var(--bg-elevated)] overflow-hidden">
        {/* Export toolbar */}
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-2.5">
          <ExportBar
            canExport={session.previewPanels.length > 0}
            isExporting={session.isExporting}
            format={exportFormat}
            onFormatChange={setExportFormat}
            onExport={handleExport}
            totalPages={totalPages}
            pageIndex={session.currentPageIndex}
            onPrev={() => session.setCurrentPageIndex(Math.max(0, session.currentPageIndex - 1))}
            onNext={() => session.setCurrentPageIndex(Math.min(totalPages - 1, session.currentPageIndex + 1))}
          />
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
          {currentPanel ? (
            <SheetPreview
              panel={currentPanel}
              logoCenterUrl={logoCenterUrl}
              images={imagesMap}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <FileDown size={20} className="text-[var(--text-muted)]" />
              <p className="text-xs text-[var(--text-muted)] max-w-[240px]">
                Configura los datos o importa un Excel para ver la vista previa.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
