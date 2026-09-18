import type { FormatInfo, VisualMapping } from '../types';
import { _invoke, _invokeInvalidating, cachedInvoke, invalidateApiCache } from './core';
import type { HtmlToPdfResponse } from './toolsApi';

export type FormatosGenerateResponse = HtmlToPdfResponse;

export const formatosApi = {
  formatosList: () =>
    cachedInvoke('formatos_list', () => _invoke<{ formats: FormatInfo[] }>('formatos_list')),
  formatosGenerate: (body: { format_id: string; desde: number; hasta: number; output_path?: string }) =>
    _invoke<FormatosGenerateResponse>('formatos_generate', body),
  formatosUpload: (body: { nombre: string; filename: string; content_b64: string; persisted?: boolean; filename_pattern?: string }) =>
    _invokeInvalidating<{ format: FormatInfo }>('formatos_upload', () => invalidateApiCache('formatos_list'), body),
  formatosDelete: (format_id: string) =>
    _invokeInvalidating<{ deleted_id: string | null }>('formatos_delete', () => invalidateApiCache('formatos_list'), { format_id }),
  formatosGetTemplate: (format_id: string) =>
    _invoke<{ pdf_base64: string; filename: string }>('formatos_get_template', { format_id }),
  formatosRenderTemplatePage: (body: { format_id: string; page_num?: number; max_width?: number }) =>
    _invoke<{
      image_base64: string;
      page_width: number;
      page_height: number;
      mime_type: string;
    }>('formatos_render_template_page', body),
  formatosUpdateMapping: (format_id: string, mapping: VisualMapping) =>
    _invokeInvalidating<{ format: FormatInfo }>('formatos_update_mapping', () => invalidateApiCache('formatos_list'), { format_id, mapping }),
};
