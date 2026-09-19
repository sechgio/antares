import { useCallback, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { changeLogoFile } from "../../utils/logoFile";
import { renderPdfDownload } from "../../utils/renderPdfDownload";
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
      await changeLogoFile(
        file,
        (url) => {
          if (side === "left") setLogoLeft(url);
          else setLogoRight(url);
        },
        (error) =>
          addToast({
            message: errorMessage(error, "No se pudo cargar el logo"),
            type: "error",
          }),
      );
    },
    [addToast],
  );

  const exportCurrent = useCallback(async () => {
    if (!formData) return;
    try {
      await runOperation(async () => {
        const reportForRender = hasChanges ? await saveCurrent() : formData;
        if (!reportForRender) return;
        await renderPdfDownload({
          render: () =>
            technicalReportsApi.renderHtml({
              id: reportForRender.id,
              report: reportForRender,
              logo_left: logoLeft,
              logo_right: logoRight,
            }),
          htmlToPdf: technicalReportsApi.htmlToPdf,
          runType: "informe_tecnico",
          history: () => ({
            details: { type: "individual", reportId: reportForRender.id },
          }),
          missingPdfError: "No se recibio el contenido del PDF generado.",
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
        const rendered = await renderPdfDownload({
          render: () =>
            technicalReportsApi.renderConsolidatedHtml({
              logo_left: logoLeft,
              logo_right: logoRight,
            }),
          htmlToPdf: technicalReportsApi.htmlToPdf,
          runType: "informe_tecnico",
          history: (r) => ({
            details: { type: "consolidado", count: r.count },
            count: r.count,
          }),
          missingPdfError: "No se recibio el contenido del PDF generado.",
        });
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
