import type { PanelMatchResponse, PanelVM } from '../components/panel-aviso-corte/types';
import { _invoke } from './core';

export const panelAvisoCorteApi = {
  panelAvisoCorteParseExcel: (body: { xlsx_b64: string; filename: string }) =>
    _invoke<{ columns: string[]; normalizedColumns: string[]; rows: Array<Record<string, string>>; warnings: string[] }>('panel_aviso_corte_parse_excel', body),
  panelAvisoCorteComputeMatch: (body: {
    rows: Array<Record<string, string>>;
    key_column: string;
    strategy: string;
    pattern?: string;
    address_column?: string;
    image_names: string[];
    export_mode: string;
  }) => _invoke<PanelMatchResponse>('panel_aviso_corte_compute_match', body),
  panelAvisoCorteRenderPdf: (body: {
    panels: Array<Record<string, unknown>> | PanelVM[];
    logos: { left_b64?: string; right_b64?: string };
    images: Record<string, string>;
    image_paths?: Record<string, string>;
    format?: string;
    template_id?: string;
    output_path?: string;
    export_mode?: string;
  }) => _invoke<{ content_base64: string; saved_path?: string; filename: string; format?: string; mime_type?: string }>('panel_aviso_corte_render_pdf', body),
  panelAvisoCorteTemplate: (body: { output_path: string; overwrite?: boolean }) => _invoke<{ path: string }>('panel_aviso_corte_template', body),
};
