import { api } from '../../api';
import type { TechnicalReport, TechnicalReportListItem } from './types';

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

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function downloadBase64Pdf(pdf_base64: string, filename: string): void {
  const binary = atob(pdf_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
