import { api } from '../../../api';
import type { CanvasDocument, CanvasLayer } from '../types';
import { newId } from '../types';
import { planMultiPageRender, renderMultiPageHtmlAsync } from '../runtime/planning';
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

/**
 * Expand each FillContext via planMultiPageRender into a flat document where
 * pageIndex 0..N-1 aligns 1:1 with contexts (pair_context_pages on the backend).
 */
function expandCmykDocument(
  document: CanvasDocument,
  contexts: FillContext[],
): { document: CanvasDocument; contexts: FillContext[] } {
  const pages: Array<{ id: string; name: string }> = [];
  const layers: CanvasLayer[] = [];
  const paired: FillContext[] = [];
  let pageIndex = 0;

  for (const raw of contexts) {
    const ctx: FillContext = {
      data: raw.data ?? {},
      images: raw.images ?? [],
      logoLeft: raw.logoLeft ?? null,
      logoRight: raw.logoRight ?? null,
      imageMeta: raw.imageMeta,
    };
    const plan = planMultiPageRender(document, ctx);
    for (const { pageDoc, pageCtx } of plan) {
      pages.push({ id: newId(), name: `Página ${pageIndex + 1}` });
      for (const layer of pageDoc.layers) {
        layers.push({ ...layer, pageIndex });
      }
      paired.push(pageCtx);
      pageIndex += 1;
    }
  }

  return {
    document: { ...document, pages, layers },
    contexts: paired,
  };
}

export async function exportCanvasPdf(
  options: ExportCanvasPdfOptions,
): Promise<{ saved_path?: string; filename: string; pdf_base64?: string }> {
  const { prepareDocumentImagesForExport } = await import('../utils/imageBlobStore');
  const mode = options.colorMode === 'cmyk' ? 'cmyk' : 'rgb';
  const document = await prepareDocumentImagesForExport(options.document, { mode });

  if (options.colorMode === 'cmyk') {
    const expanded = expandCmykDocument(document, options.contexts);
    return api.canvasExportCmykPdf({
      document: expanded.document,
      contexts: expanded.contexts,
      pair_context_pages: true,
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
    htmlParts.push(await renderMultiPageHtmlAsync(document, options.contexts[i]));
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
