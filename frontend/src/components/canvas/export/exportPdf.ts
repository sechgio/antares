import { api } from '../../../api';
import type { CanvasDocument } from '../types';
import { renderMultiPageHtmlAsync } from '../ops/pages';
import { mergeCanvasHtmlDocuments, type FillContext } from '../runtime/renderHtml';

/** Yield to the event loop so large bulk exports do not freeze the UI. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

const YIELD_EVERY_CONTEXT = 2;

export interface ExportCanvasPdfOptions {
  document: CanvasDocument;
  contexts: FillContext[];
  filename: string;
  outputPath?: string;
  localImagePaths?: Record<string, string>;
  colorMode?: 'rgb' | 'cmyk';
  colorProfile?: string;
  dpi?: number;
  bleedMm?: number;
  showCropMarks?: boolean;
}

export async function exportCanvasPdf(
  options: ExportCanvasPdfOptions,
): Promise<{ saved_path?: string; filename: string; pdf_base64?: string }> {
  if (options.colorMode === 'cmyk') {
    return api.canvasExportCmykPdf({
      document: options.document,
      contexts: options.contexts,
      color_profile: options.colorProfile || 'cmyk_iso_coated_v2',
      dpi: options.dpi || 300,
      bleed_mm: options.bleedMm || 0.0,
      show_crop_marks: !!options.showCropMarks,
      filename: options.filename,
      outputPath: options.outputPath,
      localImagePaths: options.localImagePaths,
    });
  }

  const htmlParts: string[] = [];
  for (let i = 0; i < options.contexts.length; i += 1) {
    // Yields between pages inside each context, and between contexts.
    htmlParts.push(await renderMultiPageHtmlAsync(options.document, options.contexts[i]));
    if (i > 0 && i % YIELD_EVERY_CONTEXT === 0) {
      await yieldToMain();
    }
  }
  const html = mergeCanvasHtmlDocuments(htmlParts);
  return api.htmlToPdf({
    html,
    filename: options.filename,
    outputPath: options.outputPath,
    localImagePaths: options.localImagePaths,
  });
}

