import '../technical-reports/technical-reports.css';
import './informes-v2.css';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Database, Download, Eye, FileDown, FilePlus2, Files, PenLine, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { saveFeatureHistory } from '../../utils/history';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Blob, downloadBase64Pdf, fileToBase64, fileToDataUrl, informesV2Api } from './api';
import {
  askPdfSavePath,
  logoToPdfPath,
  preparePhotosForExport,
  type LogoAsset,
} from './exportPdf';
import { matchPhotosForId } from './photoMatch';
import type { InformeV2, InformeV2ListItem, PhotoAsset } from './types';

export default function InformesV2App() {
  const { addToast } = useToast();
  const dialog = useDialog();
  const [reports, setReports] = useState<InformeV2ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<InformeV2 | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logoLeft, setLogoLeft] = useState<LogoAsset | null>(null);
  const [logoRight, setLogoRight] = useState<LogoAsset | null>(null);
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
  const [mobileTab, setMobileTab] = useState<'db' | 'preview' | 'form'>('db');
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectGenRef = useRef(0);

  const hasChanges = dirtyCount > 0;
  const logoLeftSrc = logoLeft?.src ?? null;
  const logoRightSrc = logoRight?.src ?? null;

  const matchedPhotos = useMemo(() => {
    if (!formData) return [];
    return matchPhotosForId(photos, formData.header.photo_id);
  }, [formData, photos]);

  const patchForm = useCallback((report: InformeV2) => {
    setFormData(report);
    setDirtyCount((c) => c + 1);
  }, []);

  const markClean = useCallback(() => setDirtyCount(0), []);

  const loadReports = useCallback(async () => {
    setBusy(true);
    try {
      const result = await informesV2Api.list(true);
      setReports(result.reports || []);
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudieron cargar los informes', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const selectReport = useCallback(async (id: string) => {
    if (hasChanges) {
      const proceed = await dialog.confirm({
        title: 'Cambios sin guardar',
        description: 'Se perderán los cambios del informe actual.',
        confirmLabel: 'Continuar',
        cancelLabel: 'Seguir editando',
      });
      if (!proceed) return;
    }
    const gen = ++selectGenRef.current;
    setBusy(true);
    try {
      const report = await informesV2Api.get(id);
      if (gen !== selectGenRef.current) return;
      setSelectedId(id);
      setFormData(report);
      markClean();
    } catch (error) {
      if (gen !== selectGenRef.current) return;
      addToast({ message: error instanceof Error ? error.message : 'No se pudo abrir el informe', type: 'error' });
    } finally {
      if (gen === selectGenRef.current) setBusy(false);
    }
  }, [addToast, dialog, hasChanges, markClean]);

  const createReport = useCallback(async () => {
    setBusy(true);
    try {
      const report = await informesV2Api.create();
      await loadReports();
      setSelectedId(report.id);
      setFormData(report);
      markClean();
      addToast({ message: 'Informe creado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo crear el informe', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports, markClean]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      const saved = await informesV2Api.update(formData.id, formData);
      setFormData(saved);
      markClean();
      await loadReports();
      addToast({ message: 'Informe guardado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo guardar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, loadReports, markClean]);

  const deleteReport = useCallback(async () => {
    if (!selectedId) return;
    const confirmed = await dialog.confirm({
      title: 'Eliminar informe',
      description: `Se eliminará ${selectedId} de la base local.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await informesV2Api.delete(selectedId);
      setSelectedId(null);
      setFormData(null);
      markClean();
      await loadReports();
      addToast({ message: 'Informe eliminado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo eliminar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, loadReports, markClean, selectedId]);

  const clearReports = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: 'Eliminar todos los informes',
      description: 'Esta acción reemplaza la base local con una lista vacía.',
      confirmLabel: 'Eliminar todo',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await informesV2Api.clear();
      setReports([]);
      setSelectedId(null);
      setFormData(null);
      markClean();
      addToast({ message: 'Base de informes limpiada', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo limpiar la base', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, markClean]);

  const importFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const content = await fileToBase64(file);
      const result = await informesV2Api.importFile(file.name, content);
      setSelectedId(null);
      setFormData(null);
      markClean();
      await loadReports();
      addToast({ message: `${result.imported_count} informes importados`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo importar el archivo', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports, markClean]);

  const downloadTemplate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await informesV2Api.downloadTemplate();
      downloadBase64Blob(result.content_b64, result.filename, result.mime);
      addToast({ message: 'Plantilla Excel descargada', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo descargar la plantilla', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  const changeLogo = useCallback(async (side: 'left' | 'right', file: File | null) => {
    if (!file) {
      if (side === 'left') setLogoLeft(null);
      else setLogoRight(null);
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      const asset: LogoAsset = { src: url, file };
      if (side === 'left') setLogoLeft(asset);
      else setLogoRight(asset);
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo cargar el logo', type: 'error' });
    }
  }, [addToast]);

  const loadPhotos = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const fileList = Array.from(files);
      const next: PhotoAsset[] = [];
      for (const file of fileList) {
        const src = await fileToDataUrl(file);
        next.push({ name: file.name, src, file });
      }
      setPhotos((prev) => {
        const map = new Map(prev.map((p) => [p.name.toLowerCase(), p]));
        for (const photo of next) map.set(photo.name.toLowerCase(), photo);
        return [...map.values()];
      });
      addToast({ message: `${next.length} fotos cargadas`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudieron cargar las fotos', type: 'error' });
    }
  }, [addToast]);

  const exportCurrent = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      const reportForRender = hasChanges
        ? await informesV2Api.update(formData.id, formData)
        : formData;
      if (hasChanges) {
        setFormData(reportForRender);
        markClean();
        await loadReports();
      }

      const localImagePaths: Record<string, string> = {};
      const [images, pdfLogoLeft, pdfLogoRight] = await Promise.all([
        preparePhotosForExport(photos, reportForRender.header.photo_id, `iv2-${reportForRender.id}`, localImagePaths),
        logoToPdfPath(logoLeft, 'logo-left', localImagePaths),
        logoToPdfPath(logoRight, 'logo-right', localImagePaths),
      ]);
      const outputPath = await askPdfSavePath(
        `informe_v2_${reportForRender.id}.pdf`,
        'Guardar PDF del informe',
      );
      if (!outputPath) return;

      const rendered = await informesV2Api.renderHtml({
        id: reportForRender.id,
        report: reportForRender,
        logo_left: pdfLogoLeft,
        logo_right: pdfLogoRight,
        images,
      });
      const pdf = await informesV2Api.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        outputPath,
        return_base64: !outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
      });
      const savedPath = 'saved_path' in pdf ? pdf.saved_path : undefined;
      if (!savedPath && pdf.pdf_base64) {
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      }
      await saveFeatureHistory('informe_v2', pdf.filename, { type: 'individual', reportId: reportForRender.id });
      addToast({
        message: hasChanges
          ? `Informe guardado y PDF generado${savedPath ? `: ${savedPath}` : ''}`
          : `PDF generado${savedPath ? `: ${savedPath}` : ''}`,
        type: 'success',
      });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el PDF', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, hasChanges, loadReports, logoLeft, logoRight, markClean, photos]);

  const exportConsolidated = useCallback(async () => {
    if (reports.length === 0) return;
    if (hasChanges && formData) {
      const proceed = await dialog.confirm({
        title: 'Cambios sin guardar',
        description: 'Hay cambios en el informe abierto. ¿Guardarlos antes de generar el consolidado?',
        confirmLabel: 'Guardar y continuar',
        cancelLabel: 'Cancelar',
      });
      if (!proceed) return;
    }

    const outputPath = await askPdfSavePath(
      `informes_v2_consolidado_${reports.length}.pdf`,
      'Guardar PDF consolidado',
    );
    if (!outputPath) return;

    setBusy(true);
    try {
      if (hasChanges && formData) {
        const saved = await informesV2Api.update(formData.id, formData);
        setFormData(saved);
        markClean();
      }
      const list = await informesV2Api.list(true);
      const items = list.reports || [];
      if (items.length === 0) throw new Error('No hay informes para exportar');
      const fullReports = await informesV2Api.getMany(items);

      const localImagePaths: Record<string, string> = {};
      const imagesById: Record<string, Array<{ path: string; name?: string }>> = {};
      for (const report of fullReports) {
        imagesById[report.id] = await preparePhotosForExport(
          photos,
          report.header.photo_id,
          `iv2-${report.id}`,
          localImagePaths,
          'low',
        );
      }
      const [pdfLogoLeft, pdfLogoRight] = await Promise.all([
        logoToPdfPath(logoLeft, 'logo-left', localImagePaths),
        logoToPdfPath(logoRight, 'logo-right', localImagePaths),
      ]);
      const embeddedPhotos = Object.values(imagesById)
        .flat()
        .filter((img) => String(img.path || '').startsWith('data:'));
      if (embeddedPhotos.length > 0) {
        throw new Error(
          'Las fotos no tienen ruta local (requerido para consolidado). Pulsa «Cargar fotos», vuelve a elegir los archivos desde disco y reintenta.',
        );
      }

      const rendered = await informesV2Api.renderConsolidatedHtml({
        logo_left: pdfLogoLeft,
        logo_right: pdfLogoRight,
        images_by_id: imagesById,
      });
      const pdf = await informesV2Api.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        outputPath,
        return_base64: !outputPath,
        localImagePaths: Object.keys(localImagePaths).length > 0 ? localImagePaths : undefined,
      });
      const savedPath = 'saved_path' in pdf ? pdf.saved_path : undefined;
      if (!savedPath && pdf.pdf_base64) {
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      }
      await saveFeatureHistory('informe_v2', pdf.filename, { type: 'consolidado', count: rendered.count }, rendered.count);
      addToast({
        message: `PDF consolidado generado (${rendered.count})${savedPath ? `: ${savedPath}` : ''}`,
        type: 'success',
      });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el consolidado', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, formData, hasChanges, logoLeft, logoRight, markClean, photos, reports]);

  return (
    <div className="tr-app iv2-app">
      <header className="tr-header">
        <h1>INFORMES V2</h1>
        <div className="tr-header-toolbar">
          <div className="tr-header-actions">
            <button type="button" className="tr-secondary" disabled={busy} onClick={() => importInputRef.current?.click()}>
              <Upload size={16} />
              Importar
            </button>
            <button type="button" className="tr-secondary" disabled={busy} onClick={() => void downloadTemplate()}>
              <FileDown size={16} />
              Plantilla
            </button>
            <WithHoverTooltip label="Recargar" placement="bottom">
              <button type="button" className="tr-secondary tr-icon-button" disabled={busy} onClick={() => void loadReports()}>
                <RefreshCw size={16} />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Eliminar todos" placement="bottom">
              <button type="button" className="tr-danger tr-icon-button" disabled={busy || reports.length === 0} onClick={() => void clearReports()}>
                <Trash2 size={16} />
              </button>
            </WithHoverTooltip>
            <button type="button" className="tr-secondary" onClick={() => void createReport()} disabled={busy}>
              <FilePlus2 size={16} />
              Nuevo
            </button>
            <button type="button" className="tr-primary" onClick={() => void exportCurrent()} disabled={!formData || busy}>
              <Download size={16} />
              PDF
            </button>
            <button type="button" className="tr-secondary" onClick={() => void exportConsolidated()} disabled={reports.length === 0 || busy}>
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

      <nav className="tr-mobile-tabs">
        <button type="button" className={`tr-mobile-tab${mobileTab === 'db' ? ' is-active' : ''}`} onClick={() => setMobileTab('db')}>
          <Database size={14} />
          <span>Informes</span>
        </button>
        <button type="button" className={`tr-mobile-tab${mobileTab === 'preview' ? ' is-active' : ''}`} onClick={() => setMobileTab('preview')}>
          <Eye size={14} />
          <span>Vista previa</span>
        </button>
        <button type="button" className={`tr-mobile-tab${mobileTab === 'form' ? ' is-active' : ''}`} onClick={() => setMobileTab('form')}>
          <PenLine size={14} />
          <span>Editar</span>
        </button>
      </nav>

      <div className="tr-workspace" data-mobile-tab={mobileTab}>
        <DatabasePanel reports={reports} selectedId={selectedId} onSelect={(id) => void selectReport(id)} />
        <PreviewPanel report={formData} logoLeft={logoLeftSrc} logoRight={logoRightSrc} photos={matchedPhotos} />
        <FormPanel
          report={formData}
          hasChanges={hasChanges}
          busy={busy}
          logoLeft={logoLeftSrc}
          logoRight={logoRightSrc}
          photoCount={photos.length}
          onChange={patchForm}
          onSave={() => void saveReport()}
          onDelete={() => void deleteReport()}
          onLogoChange={(side, file) => void changeLogo(side, file)}
          onPhotosChange={(files) => void loadPhotos(files)}
          onClearPhotos={() => setPhotos([])}
        />
      </div>
    </div>
  );
}
