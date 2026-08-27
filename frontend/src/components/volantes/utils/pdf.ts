import type { LayoutMode } from "../types";
import type { jsPDF as JsPDF } from "jspdf";

const A4_WIDTH_MM = 297;
const A4_HEIGHT_MM = 210;

const PX_PER_MM = 3.7795;
const RENDER_SCALE = 3;

export const PDF_EXPORT_BATCH_SIZE = 10;

export const chunkExportItems = <T>(
  items: readonly T[],
  batchSize = PDF_EXPORT_BATCH_SIZE,
): T[][] => {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("Invalid PDF export batch size");
  }

  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    batches.push(items.slice(start, start + batchSize));
  }
  return batches;
};

const waitForImages = async (scope: HTMLElement): Promise<void> => {
  const images = Array.from(scope.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
};

const waitForFonts = async (): Promise<void> => {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
};

const waitForReflow = (): Promise<void> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

const rasterizeNode = async (node: HTMLElement): Promise<string> => {
  const { toJpeg } = await import("html-to-image");
  const naturalW = node.scrollWidth || node.offsetWidth;
  const targetPxW = Math.round(A4_WIDTH_MM * PX_PER_MM * RENDER_SCALE);
  const pixelRatio = targetPxW / naturalW;

  return toJpeg(node, {
    quality: 0.92,
    backgroundColor: "#ffffff",
    pixelRatio,
    width: naturalW,
    height: node.scrollHeight || node.offsetHeight,
    style: {
      margin: "0",
      padding: undefined,
    },
  });
};

export const createPdfDocument = async (): Promise<JsPDF> => {
  const { default: jsPDF } = await import("jspdf");
  return new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
};

export const appendPagesToPdf = async (
  container: HTMLElement,
  pdf: JsPDF,
  hasPreviousPages = false,
  settleDelayMs = 0,
): Promise<number> => {
  await waitForImages(container);
  await waitForFonts();

  const saved = {
    position: container.style.position,
    left: container.style.left,
    top: container.style.top,
    zIndex: container.style.zIndex,
    opacity: container.style.opacity,
    transform: container.style.transform,
    pointerEvents: container.style.pointerEvents
  };

  // Use opacity:0 instead of left:-9999px for Electron compatibility
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.zIndex = "-9999";
  container.style.opacity = "0";
  container.style.transform = "translateZ(0)";
  container.style.pointerEvents = "none";

  container.scrollTop = 0;
  container.scrollLeft = 0;

  await waitForReflow();
  if (settleDelayMs > 0) {
    await new Promise((r) => setTimeout(r, settleDelayMs));
  }

  const pageNodes = Array.from(
    container.querySelectorAll<HTMLElement>("[data-export-page='true']")
  );

  try {
    if (pageNodes.length === 0) {
      throw new Error("No hay paginas listas para exportar.");
    }

    for (let index = 0; index < pageNodes.length; index += 1) {
      const pageNode = pageNodes[index];
      pageNode.scrollTop = 0;
      pageNode.scrollLeft = 0;
      const imageData = await rasterizeNode(pageNode);

      if (hasPreviousPages || index > 0) {
        pdf.addPage("a4", "landscape");
      }

      pdf.addImage(imageData, "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, "MEDIUM");
    }
    return pageNodes.length;
  } finally {
    Object.assign(container.style, saved);
  }
};

export const savePdfDocument = (
  pdf: JsPDF,
  layoutMode: LayoutMode,
  customFileName?: string,
): void => {
  const layoutName = layoutMode === "2-up" ? "2-por-hoja" : "3-por-hoja";
  const fileName = customFileName
    ? `${customFileName}.pdf`
    : `volantes-${layoutName}.pdf`;
  pdf.save(fileName);
};

export const exportPagesToPdf = async (
  container: HTMLElement,
  layoutMode: LayoutMode,
  customFileName?: string,
): Promise<void> => {
  const pdf = await createPdfDocument();
  await appendPagesToPdf(container, pdf, false, 300);
  savePdfDocument(pdf, layoutMode, customFileName);
};
