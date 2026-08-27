import { api } from '../../api';
import { downloadBase64Blob, downloadBase64Pdf, fileToBase64, fileToDataUrl } from '../../utils/pdfAssets';
import type { InformeV2, InformeV2ListItem } from './types';

export { downloadBase64Blob, downloadBase64Pdf, fileToBase64, fileToDataUrl };

const CONSOLIDATED_READ_BATCH_SIZE = 4;

async function getReport(id: string) {
  const result = await api.informesV2Get(id) as { report: InformeV2 };
  return result.report;
}

async function getReportsInBatches(items: readonly InformeV2ListItem[]) {
  const reports: InformeV2[] = [];

  for (let offset = 0; offset < items.length; offset += CONSOLIDATED_READ_BATCH_SIZE) {
    const batch = items.slice(offset, offset + CONSOLIDATED_READ_BATCH_SIZE);
    reports.push(...await Promise.all(batch.map((item) => getReport(item.id))));
  }

  return reports;
}

export const informesV2Api = {
  list: (summary = true) =>
    api.informesV2List({ summary }) as Promise<{ reports: InformeV2ListItem[] }>,
  get: getReport,
  getMany: getReportsInBatches,
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


