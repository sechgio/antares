import { api } from '../../../api';
import type { CanvasDocument } from '../types';
import { renderMultiPageHtml } from '../ops/pages';
import { mergeCanvasHtmlDocuments, type FillContext } from '../runtime/renderHtml';

export async function exportCanvasPdf(options: {
  document: CanvasDocument;
  contexts: FillContext[];
  filename: string;
  outputPath?: string;
  localImagePaths?: Record<string, string>;
}): Promise<{ saved_path?: string; filename: string; pdf_base64?: string }> {
  const perPage = options.document.settings?.imagesPerPage;
  const htmlParts = options.contexts.map((ctx) =>
    renderMultiPageHtml(options.document, ctx, {
      imagesPerPage: perPage && perPage > 0 ? perPage : undefined,
    }),
  );
  const html = mergeCanvasHtmlDocuments(htmlParts);
  return api.htmlToPdf({
    html,
    filename: options.filename,
    outputPath: options.outputPath,
    localImagePaths: options.localImagePaths,
  });
}
