import { api } from '../../api';
import { createReportApi } from '../../api/reportApi';
import type { InformeV2, InformeV2ListItem, PlantillaId } from './types';

export const informesV2Api = {
  ...createReportApi<InformeV2, InformeV2ListItem>(
    {
      list: api.informesV2List,
      get: api.informesV2Get,
      create: api.informesV2Create,
      update: api.informesV2Update,
      delete: api.informesV2Delete,
      clear: api.informesV2Clear,
      importFile: api.informesV2ImportFile,
    },
  ),
  downloadTemplate: (plantilla: PlantillaId) => api.informesV2DownloadTemplate(plantilla),
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
