import { api } from '../../../api';
import type { CanvasDocument } from '../types';
import { renderMultiPageHtml } from '../ops/pages';
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

const YIELD_EVERY = 4;

export async function exportCanvasPdf(options: {
  document: CanvasDocument;
  contexts: FillContext[];
  filename: string;
  outputPath?: string;
  localImagePaths?: Record<string, string>;
}): Promise<{ saved_path?: string; filename: string; pdf_base64?: string }> {
  const htmlParts: string[] = [];
  for (let i = 0; i < options.contexts.length; i += 1) {
    htmlParts.push(renderMultiPageHtml(options.document, options.contexts[i]));
    if (i > 0 && i % YIELD_EVERY === 0) {
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
