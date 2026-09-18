import { api } from "../../api";
import {
  acquireStagedFile,
  type StagedFileHandle,
} from "../../utils/stageFile";
import { fileToBase64 } from "../../utils/pdfAssets";
import { saveFeatureHistory } from "../../utils/history";
import { errorMessage } from "@/utils/errors";
import {
  stripPdfExtension,
  toBackendStampPlacements,
  type ResolvedStampPlacement,
  type StampPosition,
  type StampRect,
} from "./utils";

const MAX_IN_MEMORY_BYTES = 8 * 1024 * 1024;

export interface ApplySelladoParams {
  pdfFile: File;
  pdfPath: string | null;
  pdfBase64: string | null;
  stampFile: File;
  primaryRect: StampRect;
  resolvedPlacements: ResolvedStampPlacement[];
  positions: StampPosition[];
  seed: number;
  onToast: (message: string, type: "success" | "error") => void;
}

/**
 * Orquestación de "Aplicar y guardar": diálogo de salida, resolución de
 * fuentes (ruta directa, base64 o staging), sellado vía IPC e historial.
 * Los handles de staging se liberan siempre en `finally`.
 */
export async function applySellado(params: ApplySelladoParams): Promise<void> {
  const {
    pdfFile,
    pdfPath,
    pdfBase64,
    stampFile,
    primaryRect,
    resolvedPlacements,
    positions,
    seed,
    onToast,
  } = params;

  let pdfHandle: StagedFileHandle | null = null;
  let stampHandle: StagedFileHandle | null = null;
  try {
    const defaultName = `${stripPdfExtension(pdfFile.name)}_sellado.pdf`;
    const saveTarget = await api.dialogSave({
      title: "Guardar PDF sellado",
      defaultPath: defaultName,
      filters: [
        { name: "PDF", extensions: ["pdf"] },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    const outputPath = saveTarget.paths[0];
    if (!outputPath) return;

    let pdfSource: { pdf_path: string } | { pdf_b64: string };
    if (pdfPath) {
      pdfSource = { pdf_path: pdfPath };
    } else if (pdfBase64) {
      pdfSource = { pdf_b64: pdfBase64 };
    } else {
      pdfHandle = await acquireStagedFile(pdfFile);
      if (pdfHandle.token) {
        pdfSource = { pdf_path: pdfHandle.token };
      } else {
        pdfHandle.release();
        pdfHandle = null;
        if (pdfFile.size > MAX_IN_MEMORY_BYTES) {
          throw new Error("PDF demasiado grande para procesarlo sin staging.");
        }
        pdfSource = { pdf_b64: await fileToBase64(pdfFile) };
      }
    }

    const stampPlacements = toBackendStampPlacements(resolvedPlacements);
    const applyBase = {
      ...pdfSource,
      stamp_count: resolvedPlacements.length,
      x: primaryRect.x,
      y: primaryRect.y,
      width: primaryRect.width,
      height: primaryRect.height,
      stamp_placements: stampPlacements,
      seed,
      filename: defaultName,
      output_path: outputPath,
    };
    stampHandle = await acquireStagedFile(stampFile);
    let stampSource: { stamp_path: string } | { stamp_b64: string };
    if (stampHandle.token) {
      stampSource = { stamp_path: stampHandle.token };
    } else {
      stampHandle.release();
      stampHandle = null;
      stampSource = { stamp_b64: await fileToBase64(stampFile) };
    }
    const res = await api.selladorApply({ ...applyBase, ...stampSource });

    onToast(
      res.saved_path
        ? `PDF guardado: ${res.filename}`
        : "PDF sellado correctamente.",
      "success",
    );

    await saveFeatureHistory(
      "sellador",
      res.filename || defaultName,
      {
        stamp_count: resolvedPlacements.length,
        stamped_pages: res.stamped_pages,
        positions: positions.length,
        x: primaryRect.x,
        y: primaryRect.y,
        width: primaryRect.width,
        height: primaryRect.height,
        seed: res.seed,
        source: pdfFile.name,
      },
      res.stamp_count,
    );
  } catch (error) {
    onToast(errorMessage(error, "No se pudo sellar el PDF."), "error");
  } finally {
    pdfHandle?.release();
    stampHandle?.release();
  }
}
