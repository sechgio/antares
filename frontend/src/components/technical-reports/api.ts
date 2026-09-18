import { api } from '../../api';
import { createReportApi } from '../../api/reportApi';
import type { TechnicalReport, TechnicalReportListItem } from './types';

export const technicalReportsApi = {
  ...createReportApi<TechnicalReport, TechnicalReportListItem>(
    {
      list: api.technicalReportsList,
      get: api.technicalReportsGet,
      create: api.technicalReportsCreate,
      update: api.technicalReportsUpdate,
      delete: api.technicalReportsDelete,
      clear: api.technicalReportsClear,
      importFile: api.technicalReportsImportFile,
    },
  ),
  renderHtml: (body: { id?: string; report?: TechnicalReport; logo_left?: string | null; logo_right?: string | null }) =>
    api.technicalReportsRenderHtml(body),
  renderConsolidatedHtml: (body: { report_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    api.technicalReportsRenderConsolidatedHtml(body),
  htmlToPdf: api.htmlToPdf,
};
