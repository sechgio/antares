import { api } from '../../api';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl } from '../../utils/pdfAssets';
import type { TechnicalReport, TechnicalReportListItem } from './types';

export { downloadBase64Pdf, fileToBase64, fileToDataUrl };

export const technicalReportsApi = {
  list: (summary = true) =>
    api.technicalReportsList({ summary }) as Promise<{ reports: TechnicalReportListItem[] }>,
  get: async (id: string) => {
    const result = await api.technicalReportsGet(id) as { report: TechnicalReport };
    return result.report;
  },
  create: async () => {
    const result = await api.technicalReportsCreate() as { report: TechnicalReport };
    return result.report;
  },
  update: (id: string, report: TechnicalReport) => api.technicalReportsUpdate(id, report),
  delete: (id: string) => api.technicalReportsDelete(id),
  clear: () => api.technicalReportsClear(),
  importFile: (filename: string, content_b64: string) => api.technicalReportsImportFile({ filename, content_b64 }),
  renderHtml: (body: { id?: string; report?: TechnicalReport; logo_left?: string | null; logo_right?: string | null }) =>
    api.technicalReportsRenderHtml(body),
  renderConsolidatedHtml: (body: { report_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    api.technicalReportsRenderConsolidatedHtml(body),
  htmlToPdf: api.htmlToPdf,
};
