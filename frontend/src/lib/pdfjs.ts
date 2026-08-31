import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfWorkerUrl: string | null = null;
let loadPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/**
 * Load PDF.js only for features that actually inspect or render a PDF.
 * Keeping this boundary dynamic is important for Canvas cold-start size.
 */
export async function ensurePdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfWorkerUrl) {
      try {
        const workerModule = await import(
          'pdfjs-dist/build/pdf.worker.min.mjs?url'
        ) as { default: string };
        pdfWorkerUrl = workerModule.default;
      } catch {
        pdfWorkerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      }
    }
    if (pdfWorkerUrl) {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    }
    pdfjsLib = pdfjs;
    return pdfjs;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export type { PDFDocumentProxy };
