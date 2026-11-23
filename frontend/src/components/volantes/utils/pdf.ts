import type { LayoutMode } from '../types';
import type { jsPDF as JsPDF } from 'jspdf';
import {
  a4PageSizeMm,
  a4TargetPixelWidth,
  chunkExportItems,
  createA4Pdf,
  PDF_EXPORT_BATCH_SIZE,
  waitForFonts,
  waitForImages,
  waitForPaint,
} from '../../../utils/htmlToPdf';

export { chunkExportItems, PDF_EXPORT_BATCH_SIZE };

const RENDER_SCALE = 3;
const { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM } = a4PageSizeMm('landscape');

const rasterizeNode = async (node: HTMLElement): Promise<string> => {
  const { toJpeg } = await import('html-to-image');
  const naturalW = node.scrollWidth || node.offsetWidth;
  const targetPxW = a4TargetPixelWidth(A4_WIDTH_MM, RENDER_SCALE);
  const pixelRatio = targetPxW / naturalW;

  return toJpeg(node, {
    quality: 0.92,
    backgroundColor: '#ffffff',
    pixelRatio,
    width: naturalW,
    height: node.scrollHeight || node.offsetHeight,
    style: {
      margin: '0',
      padding: undefined,
    },
  });
};

export const createPdfDocument = (): Promise<JsPDF> => createA4Pdf({ orientation: 'landscape' });

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
    pointerEvents: container.style.pointerEvents,
  };

  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.zIndex = '-9999';
  container.style.opacity = '0';
  container.style.transform = 'translateZ(0)';
  container.style.pointerEvents = 'none';

  container.scrollTop = 0;
  container.scrollLeft = 0;

  await waitForPaint();
  if (settleDelayMs > 0) {
    await new Promise((r) => setTimeout(r, settleDelayMs));
  }

  const pageNodes = Array.from(container.querySelectorAll<HTMLElement>("[data-export-page='true']"));

  try {
    if (pageNodes.length === 0) {
      throw new Error('No hay paginas listas para exportar.');
    }

    for (let index = 0; index < pageNodes.length; index += 1) {
      const pageNode = pageNodes[index];
      pageNode.scrollTop = 0;
      pageNode.scrollLeft = 0;
      const imageData = await rasterizeNode(pageNode);

      if (hasPreviousPages || index > 0) {
        pdf.addPage('a4', 'landscape');
      }

      pdf.addImage(imageData, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'MEDIUM');
      if (index < pageNodes.length - 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return pageNodes.length;
  } finally {
    Object.assign(container.style, saved);
  }
};

export const savePdfDocument = (pdf: JsPDF, layoutMode: LayoutMode, customFileName?: string): void => {
  const layoutName = layoutMode === '2-up' ? '2-por-hoja' : '3-por-hoja';
  const fileName = customFileName ? `${customFileName}.pdf` : `volantes-${layoutName}.pdf`;
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
