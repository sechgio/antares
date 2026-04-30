import { toJpeg } from "html-to-image";
import type { LayoutMode } from "../types";

const A4_WIDTH_MM = 297;
const A4_HEIGHT_MM = 210;

const PX_PER_MM = 3.7795;
const RENDER_SCALE = 3;

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

export const exportPagesToPdf = async (
  container: HTMLElement,
  layoutMode: LayoutMode,
  customFileName?: string
): Promise<void> => {
  const { default: jsPDF } = await import("jspdf");
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
  await new Promise((r) => setTimeout(r, 300));

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4"
  });

  const pageNodes = Array.from(
    container.querySelectorAll<HTMLElement>("[data-export-page='true']")
  );

  if (pageNodes.length === 0) {
    Object.assign(container.style, saved);
    throw new Error("No hay paginas listas para exportar.");
  }

  try {
    for (let index = 0; index < pageNodes.length; index += 1) {
      const pageNode = pageNodes[index];
      pageNode.scrollTop = 0;
      pageNode.scrollLeft = 0;
      const imageData = await rasterizeNode(pageNode);

      if (index > 0) {
        pdf.addPage("a4", "landscape");
      }

      pdf.addImage(imageData, "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, "MEDIUM");
    }

    const layoutName = layoutMode === "2-up" ? "2-por-hoja" : "3-por-hoja";
    const fileName = customFileName
      ? `${customFileName}.pdf`
      : `volantes-${layoutName}.pdf`;
    pdf.save(fileName);
  } finally {
    Object.assign(container.style, saved);
  }
};
