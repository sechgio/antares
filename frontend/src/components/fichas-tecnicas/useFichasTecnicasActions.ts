import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useToast } from "../../hooks/useToast";
import { useDialog } from "../../hooks/useDialog";
import type { ReportWorkspaceMobileTab } from "../../hooks/useReportWorkspace";
import { downloadBase64Pdf, fileToDataUrl } from "../../utils/pdfAssets";
import { saveFeatureHistory } from "../../utils/history";
import { fichasTecnicasApi } from "./api";
import { formatIpcError } from "./formatIpcError";
import type { FichaTecnica, FichaTecnicaListItem } from "./types";

interface WorkspaceSlice {
  fichas: FichaTecnicaListItem[];
  formData: FichaTecnica | null;
  hasChanges: boolean;
  runOperation: (op: () => Promise<void>) => Promise<void>;
  saveCurrent: () => Promise<FichaTecnica | null>;
  setMobileTab: Dispatch<SetStateAction<ReportWorkspaceMobileTab>>;
}

/** Acciones de logo, exportación PDF y modo foco de FichasTecnicasApp. */
export function useFichasTecnicasActions(workspace: WorkspaceSlice) {
  const { addToast } = useToast();
  const dialog = useDialog();
  const {
    fichas,
    formData,
    hasChanges,
    runOperation,
    saveCurrent,
    setMobileTab,
  } = workspace;
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === ".") {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (focusMode) setMobileTab("preview");
  }, [focusMode, setMobileTab]);

  const changeLogo = useCallback(
    async (file: File | null) => {
      if (!file) {
        setLogoLeft(null);
        return;
      }
      try {
        setLogoLeft(await fileToDataUrl(file));
      } catch (error) {
        addToast({
          message: formatIpcError(error, "No se pudo cargar el logo"),
          type: "error",
        });
      }
    },
    [addToast],
  );

  const exportCurrent = useCallback(async () => {
    try {
      await runOperation(async () => {
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
          if (!pdf.pdf_base64)
            throw new Error("No se recibió el contenido del PDF generado.");
          downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
          await saveFeatureHistory("ficha_tecnica", pdf.filename, {
            type: "plantilla",
          });
          addToast({ message: "Plantilla PDF generada", type: "success" });
          return;
        }

        const fichaForRender = hasChanges ? await saveCurrent() : formData;
        if (!fichaForRender) return;
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
        if (!pdf.pdf_base64)
          throw new Error("No se recibió el contenido del PDF generado.");
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
        await saveFeatureHistory("ficha_tecnica", pdf.filename, {
          type: "individual",
          fichaId: fichaForRender.id,
        });
        addToast({
          message: hasChanges
            ? "Ficha guardada y PDF generado"
            : "PDF generado",
          type: "success",
        });
      });
    } catch (error) {
      addToast({
        message: formatIpcError(error, "No se pudo generar el PDF"),
        type: "error",
      });
    }
  }, [addToast, formData, hasChanges, logoLeft, runOperation, saveCurrent]);

  const exportConsolidated = useCallback(async () => {
    if (fichas.length === 0) return;
    const confirmed = await dialog.confirm({
      title: "¿Generar PDF consolidado?",
      description: `Se generará un PDF con ${fichas.length} fichas.`,
      confirmLabel: "Generar PDF",
      cancelLabel: "Cancelar",
    });
    if (!confirmed) return;
    try {
      await runOperation(async () => {
        const rendered = await fichasTecnicasApi.renderConsolidatedHtml({
          logo_left: logoLeft,
        });
        const pdf = await fichasTecnicasApi.htmlToPdf({
          html: rendered.html,
          filename: rendered.filename,
          return_base64: true,
        });
        if (!pdf.pdf_base64)
          throw new Error("No se recibió el contenido del PDF generado.");
        downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
        await saveFeatureHistory(
          "ficha_tecnica",
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
        message: formatIpcError(error, "No se pudo generar el consolidado"),
        type: "error",
      });
    }
  }, [addToast, dialog, fichas.length, logoLeft, runOperation]);

  return { logoLeft, focusMode, changeLogo, exportCurrent, exportConsolidated };
}
