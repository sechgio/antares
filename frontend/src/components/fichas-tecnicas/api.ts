import { api } from '../../api';
import { createReportApi } from '../../api/reportApi';
import type { FichaTecnica, FichaTecnicaListItem } from './types';

export const fichasTecnicasApi = {
  ...createReportApi<FichaTecnica, FichaTecnicaListItem>(
    {
      list: api.fichasTecnicasList,
      get: api.fichasTecnicasGet,
      create: api.fichasTecnicasCreate,
      update: api.fichasTecnicasUpdate,
      delete: api.fichasTecnicasDelete,
      clear: api.fichasTecnicasClear,
      importFile: api.fichasTecnicasImportFile,
    },
  ),
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
