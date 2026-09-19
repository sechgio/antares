import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useToast } from "../../hooks/useToast";
import { useDialog } from "../../hooks/useDialog";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import type { ReportWorkspaceMobileTab } from "../../hooks/useReportWorkspace";
import { changeLogoFile } from "../../utils/logoFile";
import { renderPdfDownload } from "../../utils/renderPdfDownload";
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

  useKeyboardShortcut(
    ".",
    () => setFocusMode((value) => !value),
    { ctrl: true, allowInInput: true },
  );

  useEffect(() => {
    if (focusMode) setMobileTab("preview");
  }, [focusMode, setMobileTab]);

  const changeLogo = useCallback(
    async (file: File | null) => {
      await changeLogoFile(
        file,
        setLogoLeft,
        (error) =>
          addToast({
            message: formatIpcError(error, "No se pudo cargar el logo"),
            type: "error",
          }),
      );
    },
    [addToast],
  );

  const exportCurrent = useCallback(async () => {
    try {
      await runOperation(async () => {
        if (!formData) {
          await renderPdfDownload({
            render: () =>
              fichasTecnicasApi.renderHtml({ template: true, logo_left: logoLeft }),
            htmlToPdf: fichasTecnicasApi.htmlToPdf,
            runType: "ficha_tecnica",
            history: () => ({ details: { type: "plantilla" } }),
          });
          addToast({ message: "Plantilla PDF generada", type: "success" });
          return;
        }

        const fichaForRender = hasChanges ? await saveCurrent() : formData;
        if (!fichaForRender) return;
        await renderPdfDownload({
          render: () =>
            fichasTecnicasApi.renderHtml({
              id: fichaForRender.id,
              ficha: fichaForRender,
              logo_left: logoLeft,
            }),
          htmlToPdf: fichasTecnicasApi.htmlToPdf,
          runType: "ficha_tecnica",
          history: () => ({
            details: { type: "individual", fichaId: fichaForRender.id },
          }),
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
        const rendered = await renderPdfDownload({
          render: () =>
            fichasTecnicasApi.renderConsolidatedHtml({ logo_left: logoLeft }),
          htmlToPdf: fichasTecnicasApi.htmlToPdf,
          runType: "ficha_tecnica",
          history: (r) => ({
            details: { type: "consolidado", count: r.count },
            count: r.count,
          }),
        });
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
