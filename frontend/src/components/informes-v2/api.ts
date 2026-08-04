import { api } from '../../api';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl } from '../../utils/pdfAssets';
import type { InformeV2, InformeV2ListItem } from './types';

export { downloadBase64Pdf, fileToBase64, fileToDataUrl };

export const informesV2Api = {
  list: (summary = true) =>
    api.informesV2List({ summary }) as Promise<{ reports: InformeV2ListItem[] }>,
  get: async (id: string) => {
    const result = await api.informesV2Get(id) as { report: InformeV2 };
    return result.report;
  },
  create: async () => {
    const result = await api.informesV2Create() as { report: InformeV2 };
    return result.report;
  },
  update: async (id: string, report: InformeV2) => {
    const result = await api.informesV2Update(id, report) as { success: boolean; report: InformeV2 };
    return result.report;
  },
  delete: (id: string) => api.informesV2Delete(id),
  clear: () => api.informesV2Clear(),
  importFile: (filename: string, content_b64: string) => api.informesV2ImportFile({ filename, content_b64 }),
  downloadTemplate: () => api.informesV2DownloadTemplate(),
  renderHtml: (body: {
    id?: string;
    report?: InformeV2;
    logo_left?: string | null;
    logo_right?: string | null;
    images?: Array<{ path: string; name?: string }>;
  }) => api.informesV2RenderHtml(body),
  renderConsolidatedHtml: (body: {
    report_ids?: string[];
    logo_left?: string | null;
    logo_right?: string | null;
    images_by_id?: Record<string, Array<{ path: string; name?: string }>>;
  }) => api.informesV2RenderConsolidatedHtml(body),
  htmlToPdf: api.htmlToPdf,
};

export function downloadBase64File(contentB64: string, filename: string, mime: string) {
  const link = document.createElement('a');
  link.href = `data:${mime};base64,${contentB64}`;
  link.download = filename;
  link.click();
}
