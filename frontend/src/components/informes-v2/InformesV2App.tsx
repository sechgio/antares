import '../technical-reports/technical-reports.css';
import './informes-v2.css';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Download, FileDown, FilePlus2, Files, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useReportWorkspace } from '../../hooks/useReportWorkspace';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { saveFeatureHistory } from '../../utils/history';
import ReportWorkspaceShell from '../report-workspace/ReportWorkspaceShell';
import Button from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Blob, downloadBase64Pdf, fileToDataUrl } from '../../utils/pdfAssets';
import { changeLogoFile } from '../../utils/logoFile';
import { askPdfSavePath } from '../../utils/deliverRenderedDocument';
import { informesV2Api } from './api';
import { createEmptyInforme, normalizeInforme } from './types';
import {
  logoToPdfPath,
  preparePhotosForExport,
  type LogoAsset,
} from './exportPdf';
import { matchPhotosForId } from './photoMatch';
import type { PhotoAsset, PlantillaId } from './types';
import { errorMessage } from '@/utils/errors';

const PLANTILLA_OPTIONS: Array<{ value: PlantillaId; label: string }> = [
  { value: 'clasica', label: 'Clásica' },
  { value: 'reservorios2', label: 'Nueva' },
];

export default function InformesV2App() {
  const { addToast } = useToast();
  const dialog = useDialog();
  const {
    reports,
    selectedId,
    formData,
    hasChanges,
    busy,
    runOperation,
    mobileTab,
    setMobileTab,
    importInputRef,
    patchForm,
    loadReports,
    selectReport,
    createReport,
    saveReport,
    saveCurrent,
    deleteReport,
    clearReports,
    importFile,
  } = useReportWorkspace(informesV2Api, { normalizeItem: normalizeInforme });
  const [logoLeft, setLogoLeft] = useState<LogoAsset | null>(null);
  const [logoRight, setLogoRight] = useState<LogoAsset | null>(null);
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);

  const logoLeftSrc = logoLeft?.src ?? null;
  const logoRightSrc = logoRight?.src ?? null;

  const matchedPhotos = useMemo(() => {
    if (!formData) return [];
    return matchPhotosForId(photos, formData.header.photo_id);
  }, [formData, photos]);

  // El switcher actúa como vista: sin informe abierto fija la plantilla por defecto;
  // con informe abierto cambia la plantilla de ese informe.
  const [plantillaDefault, setPlantillaDefault] = useState<PlantillaId>('clasica');
  const plantillaSeleccionada = formData?.plantilla ?? plantillaDefault;
  const previewVacio = useMemo(
    () =>
      plantillaSeleccionada === 'reservorios2'
        ? { ...createEmptyInforme(), plantilla: 'reservorios2' as PlantillaId }
        : null,
    [plantillaSeleccionada],
  );

  // «Nuevo» crea la hoja con la plantilla seleccionada; con la clásica no hay que sembrar nada.
  const crearNuevo = useCallback(() => {
    void createReport(
      plantillaSeleccionada !== 'clasica' ? { plantilla: plantillaSeleccionada } : undefined,
    );
  }, [createReport, plantillaSeleccionada]);

  const downloadTemplate = useCallback(async () => {
    try {
      await runOperation(async () => {
        const result = await informesV2Api.downloadTemplate(plantillaSeleccionada);
        downloadBase64Blob(result.content_b64, result.filename, result.mime);
        addToast({ message: 'Plantilla Excel descargada', type: 'success' });
      });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo descargar la plantilla'), type: 'error' });
    }
  }, [addToast, plantillaSeleccionada, runOperation]);

  const changeLogo = useCallback(async (side: 'left' | 'right', file: File | null) => {
    await changeLogoFile(
      file,
      (url, picked) => {
        const asset: LogoAsset | null = url && picked ? { src: url, file: picked } : null;
        if (side === 'left') setLogoLeft(asset);
        else setLogoRight(asset);
      },
      (error) =>
        addToast({ message: errorMessage(error, 'No se pudo cargar el logo'), type: 'error' }),
    );
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
      addToast({ message: errorMessage(error, 'No se pudieron cargar las fotos'), type: 'error' });
    }
  }, [addToast]);

  const exportCurrent = useCallback(async () => {
    if (!formData) return;
    try {
      await runOperation(async () => {
        const reportForRender = hasChanges ? await saveCurrent() : formData;
        if (!reportForRender) return;

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
      });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo generar el PDF'), type: 'error' });
    }
  }, [addToast, formData, hasChanges, logoLeft, logoRight, photos, runOperation, saveCurrent]);

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

    try {
      await runOperation(async () => {
        if (hasChanges && formData) {
          await saveCurrent();
        }
        const list = await informesV2Api.list(true);
        const items = list.reports || [];
        if (items.length === 0) throw new Error('No hay informes para exportar');

        const localImagePaths: Record<string, string> = {};
        const imagesById: Record<string, Array<{ path: string; name?: string }>> = {};
        for (const report of items) {
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
      });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo generar el consolidado'), type: 'error' });
    }
  }, [addToast, dialog, formData, hasChanges, logoLeft, logoRight, photos, reports, runOperation, saveCurrent]);

  return (
    <ReportWorkspaceShell
      title="INFORMES V2"
      appClassName="iv2-app"
      importInputRef={importInputRef}
      onImportFile={(file) => void importFile(file, { plantilla: plantillaSeleccionada })}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      dbTabLabel="Informes"
      tabsAriaLabel="Vista de informes v2"
      headerCenter={
        <SegmentedControl
          aria-label="Plantilla"
          className="iv2-header-switch"
          options={PLANTILLA_OPTIONS}
          value={plantillaSeleccionada}
          disabled={busy}
          onChange={(plantilla) => {
            setPlantillaDefault(plantilla);
            if (formData) patchForm({ ...formData, plantilla });
          }}
        />
      }
      actions={
        <>
          <WithHoverTooltip label="Importar" placement="bottom">
            <Button variant="none" size="none" className="tr-secondary tr-icon-button" aria-label="Importar" disabled={busy} onClick={() => importInputRef.current?.click()}>
              <Upload size={16} />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Descargar plantilla" placement="bottom">
            <Button variant="none" size="none" className="tr-secondary tr-icon-button" aria-label="Descargar plantilla" disabled={busy} onClick={() => void downloadTemplate()}>
              <FileDown size={16} />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Recargar" placement="bottom">
            <Button variant="none" size="none" className="tr-secondary tr-icon-button" aria-label="Recargar" disabled={busy} onClick={() => void loadReports()}>
              <RefreshCw size={16} />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Eliminar todos" placement="bottom">
            <Button variant="none" size="none" className="tr-danger tr-icon-button" aria-label="Eliminar todos" disabled={busy || reports.length === 0} onClick={() => void clearReports()}>
              <Trash2 size={16} />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Nuevo" placement="bottom">
            <Button variant="none" size="none" className="tr-secondary tr-icon-button" aria-label="Nuevo" onClick={crearNuevo} disabled={busy}>
              <FilePlus2 size={16} />
            </Button>
          </WithHoverTooltip>
          <Button variant="none" size="none" className="tr-primary" onClick={() => void exportCurrent()} disabled={!formData || busy}>
            <Download size={16} />
            PDF
          </Button>
          <Button variant="none" size="none" className="tr-secondary" onClick={() => void exportConsolidated()} disabled={reports.length === 0 || busy}>
            <Files size={16} />
            Consolidado
          </Button>
        </>
      }
    >
      <DatabasePanel reports={reports} selectedId={selectedId} onSelect={(id) => void selectReport(id)} />
      <PreviewPanel report={formData ?? previewVacio} logoLeft={logoLeftSrc} logoRight={logoRightSrc} photos={matchedPhotos} />
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
    </ReportWorkspaceShell>
  );
}
