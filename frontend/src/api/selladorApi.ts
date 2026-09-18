import { _invoke } from './core';

export const selladorApi = {
  selladorInspectPdf: (body: { pdf_path: string }) =>
    _invoke<{
      filename: string;
      page_count: number;
      page_width: number;
      page_height: number;
    }>('sellador_inspect_pdf', body),
  selladorRenderPage: (body: { pdf_path: string; page_num?: number; max_width?: number }) =>
    _invoke<{
      image_base64: string;
      page_width: number;
      page_height: number;
      mime_type: string;
    }>('sellador_render_page', body),
  selladorApply: (body: {
    pdf_b64?: string;
    pdf_path?: string;
    stamp_b64?: string;
    stamp_path?: string;
    stamp_count: number;
    x: number;
    y: number;
    width: number;
    height: number;
    seed?: number;
    filename?: string;
    output_path?: string;
    stamp_placements?: Array<{
      page_index: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }) => _invoke<{
    pdf_base64?: string;
    saved_path?: string;
    filename: string;
    stamp_count: number;
    stamped_pages: number[];
    page_assignments: number[];
    seed: number;
  }>('sellador_apply', body),
};
