import { useCallback, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { downloadBase64Pdf, fileToDataUrl } from "../../utils/pdfAssets";
import { saveFeatureHistory } from "../../utils/history";
import { errorMessage } from "@/utils/errors";
import { technicalReportsApi } from "./api";
import type { TechnicalReport, TechnicalReportListItem } from "./types";

interface WorkspaceSlice {
  reports: TechnicalReportListItem[];
  formData: TechnicalReport | null;
  hasChanges: boolean;
  runOperation: (op: () => Promise<void>) => Promise<void>;
  saveCurrent: () => Promise<TechnicalReport | null>;
}

/** Acciones de logos y exportación PDF de TechnicalReportsApp. */
export function useTechnicalReportsActions(workspace: WorkspaceSlice) {
  const { addToast } = useToast();
  const { formData, hasChanges, reports, runOperation, saveCurrent } =
    workspace;
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);

  const changeLogo = useCallback(
    async (side: "left" | "right", file: File | null) => {
      if (!file) {
        if (side === "left") setLogoLeft(null);
        else setLogoRight(null);
        return;
      }
      try {
        const url = await fileToDataUrl(file);
        if (side === "left") setLogoLeft(url);
        else setLogoRight(url);
      } catch (error) {
        addToast({
          message: errorMessage(error, "No se pudo cargar el logo"),
          type: "error",
        });
      }
    },
    [addToast],
  );

  const exportCurrent = useCallback(async () => {
    if (!formData) return;
    try {
      await runOperation(async () => {
        const reportForRender = hasChanges ? await saveCurrent() : formData;
        if (!reportForRender) return;
        const rendered = await technicalReportsApi.renderHtml({
          id: reportForRender.id,
          report: reportForRender,
          logo_left: logoLeft,
          logo_right: logoRight,
        });
        const pdf = await technicalReportsApi.htmlToPdf({
          html: rendered.html,
          filename: rendered.filename,
          return_base64: true,
        });
        if (!pdf.pdf_base64)
          throw new Error("No se recibio el contenido del PDF generado.");
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
        await saveFeatureHistory("informe_tecnico", pdf.filename, {
          type: "individual",
          reportId: reportForRender.id,
        });
        addToast({
          message: hasChanges
            ? "Informe guardado y PDF generado"
            : "PDF generado",
          type: "success",
        });
      });
    } catch (error) {
      addToast({
        message: errorMessage(error, "No se pudo generar el PDF"),
        type: "error",
      });
    }
  }, [
    addToast,
    formData,
    hasChanges,
    logoLeft,
    logoRight,
    runOperation,
    saveCurrent,
  ]);

  const exportConsolidated = useCallback(async () => {
    if (reports.length === 0) return;
    try {
      await runOperation(async () => {
        const rendered = await technicalReportsApi.renderConsolidatedHtml({
          logo_left: logoLeft,
          logo_right: logoRight,
        });
        const pdf = await technicalReportsApi.htmlToPdf({
          html: rendered.html,
          filename: rendered.filename,
          return_base64: true,
        });
        if (!pdf.pdf_base64)
          throw new Error("No se recibio el contenido del PDF generado.");
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
        await saveFeatureHistory(
          "informe_tecnico",
          pdf.filename,
          { type: "consolidado", count: rendered.count },
          rendered.count,
        );
        addToast({
          message: `PDF consolidado generado (${rendered.count})`,
          type: "success",
        });
      });
    } catch (error) {
      addToast({
        message: errorMessage(error, "No se pudo generar el consolidado"),
        type: "error",
      });
    }
  }, [addToast, logoLeft, logoRight, reports.length, runOperation]);

  return { logoLeft, logoRight, changeLogo, exportCurrent, exportConsolidated };
}
