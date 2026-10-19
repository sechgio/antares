import type { FichaTecnica, FichaTecnicaListItem } from '../components/fichas-tecnicas/types';
import type { InformeV2, InformeV2ListItem } from '../components/informes-v2/types';
import type { TechnicalReport, TechnicalReportListItem } from '../components/technical-reports/types';
import { _invoke } from './core';
import type { ReportImportEnvelope, ReportItemEnvelope, ReportListEnvelope } from './reportApi';

export interface TechnicalReportsListBody {
  cs?: string;
  contratista?: string;
  status?: string;
  summary?: boolean;
}

export interface TechnicalReportsImportBody {
  filename: string;
  content_b64: string;
}

export interface TechnicalReportsRenderBody {
  id?: string;
  report?: Partial<TechnicalReport>;
  logo_left?: string | null;
  logo_right?: string | null;
}

export interface InformesV2ListBody {
  q?: string;
  status?: string;
  summary?: boolean;
}

export interface InformesV2ImportBody {
  filename: string;
  content_b64: string;
  plantilla?: string;
}

export interface InformesV2RenderBody {
  id?: string;
  report?: Partial<InformeV2>;
  logo_left?: string | null;
  logo_right?: string | null;
  images?: Array<{ path: string; name?: string }>;
}

export interface FichasTecnicasListBody {
  cliente?: string;
  distrito?: string;
  status?: string;
  summary?: boolean;
}

export interface FichasTecnicasImportBody {
  filename: string;
  content_b64: string;
}

export interface FichasTecnicasRenderBody {
  id?: string;
  ficha?: Partial<FichaTecnica>;
  template?: boolean;
  logo_left?: string | null;
  logo_right?: string | null;
}

export const reportsApi = {
  technicalReportsList: (body?: TechnicalReportsListBody) =>
    _invoke<ReportListEnvelope<TechnicalReportListItem | TechnicalReport>>('technical_reports_list', body),
  technicalReportsGet: (id: string) =>
    _invoke<ReportItemEnvelope<TechnicalReport>>('technical_reports_get', { id }),
  technicalReportsCreate: (report?: Partial<TechnicalReport>) =>
    _invoke<ReportItemEnvelope<TechnicalReport>>('technical_reports_create', report ? { report } : {}),
  technicalReportsUpdate: (id: string, report: Partial<TechnicalReport>) =>
    _invoke<ReportItemEnvelope<TechnicalReport>>('technical_reports_update', { id, report }),
  technicalReportsDelete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('technical_reports_delete', { id }),
  technicalReportsClear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('technical_reports_clear'),
  technicalReportsImportFile: (body: TechnicalReportsImportBody) =>
    _invoke<ReportImportEnvelope>('technical_reports_import_file', body),
  technicalReportsAutocompleteCs: () =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_cs'),
  technicalReportsAutocompleteContratista: (cs?: string) =>
    _invoke<{ options: string[] }>('technical_reports_autocomplete_contratista', cs ? { cs } : {}),
  technicalReportsRenderHtml: (body: TechnicalReportsRenderBody) =>
    _invoke<{ html: string; filename: string }>('technical_reports_render_html', body),
  technicalReportsRenderConsolidatedHtml: (body?: { report_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    _invoke<{ html: string; filename: string; count: number }>('technical_reports_render_consolidated_html', body),

  informesV2List: (body?: InformesV2ListBody) =>
    _invoke<ReportListEnvelope<InformeV2ListItem | InformeV2>>('informes_v2_list', body),
  informesV2Get: (id: string) =>
    _invoke<ReportItemEnvelope<InformeV2>>('informes_v2_get', { id }),
  informesV2Create: (report?: Partial<InformeV2>) =>
    _invoke<ReportItemEnvelope<InformeV2>>('informes_v2_create', report ? { report } : {}),
  informesV2Update: (id: string, report: Partial<InformeV2>) =>
    _invoke<ReportItemEnvelope<InformeV2>>('informes_v2_update', { id, report }),
  informesV2Delete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('informes_v2_delete', { id }),
  informesV2Clear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('informes_v2_clear'),
  informesV2ImportFile: (body: InformesV2ImportBody) =>
    _invoke<ReportImportEnvelope>('informes_v2_import_file', body),
  informesV2DownloadTemplate: (plantilla?: string) =>
    _invoke<{ filename: string; content_b64: string; mime: string }>(
      'informes_v2_download_template',
      plantilla ? { plantilla } : undefined,
    ),
  informesV2RenderHtml: (body: InformesV2RenderBody) =>
    _invoke<{ html: string; filename: string }>('informes_v2_render_html', body),
  informesV2RenderConsolidatedHtml: (body?: {
    report_ids?: string[];
    logo_left?: string | null;
    logo_right?: string | null;
    images_by_id?: Record<string, Array<{ path: string; name?: string }>>;
  }) =>
    _invoke<{ html: string; filename: string; count: number }>('informes_v2_render_consolidated_html', body),

  fichasTecnicasList: (body?: FichasTecnicasListBody) =>
    _invoke<ReportListEnvelope<FichaTecnicaListItem | FichaTecnica>>('fichas_tecnicas_list', body),
  fichasTecnicasGet: (id: string) =>
    _invoke<ReportItemEnvelope<FichaTecnica>>('fichas_tecnicas_get', { id }),
  fichasTecnicasCreate: (ficha?: Partial<FichaTecnica>) =>
    _invoke<ReportItemEnvelope<FichaTecnica>>('fichas_tecnicas_create', ficha ? { ficha } : {}),
  fichasTecnicasUpdate: (id: string, ficha: Partial<FichaTecnica>) =>
    _invoke<ReportItemEnvelope<FichaTecnica>>('fichas_tecnicas_update', { id, ficha }),
  fichasTecnicasDelete: (id: string) =>
    _invoke<{ success: boolean; deleted_id: string }>('fichas_tecnicas_delete', { id }),
  fichasTecnicasClear: () =>
    _invoke<{ success: boolean; deleted_count: number; message: string }>('fichas_tecnicas_clear'),
  fichasTecnicasImportFile: (body: FichasTecnicasImportBody) =>
    _invoke<ReportImportEnvelope>('fichas_tecnicas_import_file', body),
  fichasTecnicasRenderHtml: (body: FichasTecnicasRenderBody) =>
    _invoke<{ html: string; filename: string }>('fichas_tecnicas_render_html', body),
  fichasTecnicasRenderConsolidatedHtml: (body?: { ficha_ids?: string[]; logo_left?: string | null; logo_right?: string | null }) =>
    _invoke<{ html: string; filename: string; count: number }>('fichas_tecnicas_render_consolidated_html', body),
};
