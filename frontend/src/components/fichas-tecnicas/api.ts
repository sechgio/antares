import { api } from '../../api';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl } from '../../utils/pdfAssets';
import type { FichaTecnica, FichaTecnicaListItem } from './types';

export { downloadBase64Pdf, fileToBase64, fileToDataUrl };

export const fichasTecnicasApi = {
  list: (summary = true) =>
    api.fichasTecnicasList({ summary }) as Promise<{ fichas: FichaTecnicaListItem[]; total: number }>,
  get: async (id: string) => {
    const result = (await api.fichasTecnicasGet(id)) as { ficha: FichaTecnica };
    return result.ficha;
  },
  create: async (ficha?: FichaTecnica) => {
    const result = (await api.fichasTecnicasCreate(ficha)) as { success: boolean; ficha: FichaTecnica };
    return result.ficha;
  },
  update: async (id: string, ficha: FichaTecnica) => {
    const result = (await api.fichasTecnicasUpdate(id, ficha)) as { success: boolean; ficha: FichaTecnica };
    return result.ficha;
  },
  delete: (id: string) => api.fichasTecnicasDelete(id),
  clear: () => api.fichasTecnicasClear(),
  importFile: (filename: string, content_b64: string) => api.fichasTecnicasImportFile({ filename, content_b64 }),
  renderHtml: (body: {
    id?: string;
    ficha?: FichaTecnica;
    template?: boolean;
    logo_left?: string | null;
    logo_right?: string | null;
  }) => api.fichasTecnicasRenderHtml(body),
  renderConsolidatedHtml: (body?: {
    ficha_ids?: string[];
    logo_left?: string | null;
    logo_right?: string | null;
  }) => api.fichasTecnicasRenderConsolidatedHtml(body),
  htmlToPdf: api.htmlToPdf,
};
