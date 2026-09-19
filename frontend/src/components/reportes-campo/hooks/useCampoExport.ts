import { useCallback, useState } from "react";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";
import { useToast } from "../../../hooks/useToast";
import { saveFeatureHistory } from "../../../utils/history";
import { errorMessage } from "@/utils/errors";
import {
  buildIndividualFilename,
  exportConsolidatedReportPdf,
  exportReportPdf,
} from "../utils/export";
import type {
  CampoPanel,
  LogoData,
  PhotoFile,
  ReportTypeConfig,
} from "../types";

interface CampoExportParams {
  config: ReportTypeConfig;
  panels: CampoPanel[];
  selectedPanel: CampoPanel | null;
  photos: PhotoFile[];
  header: Record<string, string>;
  logoLeft: LogoData | null;
  logoRight: LogoData | null;
  exportablePanelCount: number;
}

/** Exportaciones PDF (individual/consolidada) y atajo Ctrl+Enter de ReportesCampoApp. */
export function useCampoExport(params: CampoExportParams) {
  const { addToast } = useToast();
  const {
    config,
    panels,
    selectedPanel,
    photos,
    header,
    logoLeft,
    logoRight,
    exportablePanelCount,
  } = params;
  const [isExporting, setIsExporting] = useState(false);

  const handleExportCurrent = useCallback(async () => {
    if (!selectedPanel || photos.length === 0) {
      addToast({
        message: "Agrega al menos una imagen antes de exportar.",
        type: "error",
      });
      return;
    }
    setIsExporting(true);
    try {
      const defaultFilename = buildIndividualFilename(
        config,
        selectedPanel.label,
      );
      const result = await exportReportPdf(
        config,
        header,
        photos,
        logoLeft,
        logoRight,
        { defaultFilename },
      );
      if (result.cancelled) return;
      await saveFeatureHistory(
        "reporte_campo",
        `${config.label} - ${selectedPanel.label}`,
        {
          reportType: config.id,
          type: "individual",
          photos: photos.length,
          header,
        },
        photos.length,
      );
      addToast({
        message: `PDF guardado: ${result.filename || defaultFilename}`,
        type: "success",
      });
    } catch (err: unknown) {
      const message = errorMessage(err, "Error al generar el PDF.");
      addToast({ message, type: "error" });
    } finally {
      setIsExporting(false);
    }
  }, [addToast, config, header, photos, logoLeft, logoRight, selectedPanel]);

  const handleExportConsolidated = useCallback(async () => {
    if (exportablePanelCount === 0) {
      addToast({
        message: "Agrega imágenes a al menos un panel antes de exportar.",
        type: "error",
      });
      return;
    }
    setIsExporting(true);
    try {
      const result = await exportConsolidatedReportPdf(
        config,
        panels,
        logoLeft,
        logoRight,
      );
      if (result.cancelled) return;
      await saveFeatureHistory(
        "reporte_campo",
        `${config.label} - consolidado`,
        {
          reportType: config.id,
          type: "consolidado",
          count: exportablePanelCount,
        },
        exportablePanelCount,
      );
      addToast({
        message: `PDF consolidado guardado (${exportablePanelCount} paneles)`,
        type: "success",
      });
    } catch (err: unknown) {
      const message = errorMessage(err, "Error al generar el PDF consolidado.");
      addToast({ message, type: "error" });
    } finally {
      setIsExporting(false);
    }
  }, [addToast, config, exportablePanelCount, panels, logoLeft, logoRight]);

  useKeyboardShortcut(
    "enter",
    () => {
      if (photos.length > 0 && !isExporting) {
        void handleExportCurrent();
      }
    },
    { ctrl: true, allowInInput: true },
  );

  return { isExporting, handleExportCurrent, handleExportConsolidated };
}
