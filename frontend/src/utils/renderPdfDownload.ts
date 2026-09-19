import { downloadBase64Pdf } from './pdfAssets';
import { saveFeatureHistory } from './history';

interface HtmlToPdfFn {
  (body: { html: string; filename: string; return_base64: true }): Promise<{
    pdf_base64?: string;
    filename: string;
  }>;
}

/**
 * Flujo compartido de exportación a PDF de reportes: renderiza el HTML, lo
 * convierte a PDF vía IPC, descarga el base64 resultante y registra la
 * generación en el historial. Devuelve la respuesta del render para que el
 * llamador componga su propio toast.
 */
export async function renderPdfDownload<R extends { html: string; filename: string }>(options: {
  render: () => Promise<R>;
  htmlToPdf: HtmlToPdfFn;
  runType: string;
  history: (rendered: R) => { details: Record<string, unknown>; count?: number };
  missingPdfError?: string;
}): Promise<R> {
  const rendered = await options.render();
  const pdf = await options.htmlToPdf({
    html: rendered.html,
    filename: rendered.filename,
    return_base64: true,
  });
  if (!pdf.pdf_base64) {
    throw new Error(
      options.missingPdfError ?? 'No se recibió el contenido del PDF generado.',
    );
  }
  downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
  const { details, count } = options.history(rendered);
  if (count === undefined) {
    await saveFeatureHistory(options.runType, pdf.filename, details);
  } else {
    await saveFeatureHistory(options.runType, pdf.filename, details, count);
  }
  return rendered;
}
