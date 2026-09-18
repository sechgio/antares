import { _invoke } from './core';

export const evidenciaVolanteoApi = {
  evidenciaVolanteoRender: (body: {
    title: string;
    cuadrante: string;
    cuadrante_label?: string;
    show_cuadrante_label?: boolean;
    pages: Array<{ cuadrante?: string; images: Array<{ filename: string; position: number }> }>;
    logos: { left_b64?: string; right_b64?: string };
    images?: Record<string, string>;
    image_paths?: Record<string, string>;
    html?: string;
    format?: string;
    output_path?: string;
  }) => _invoke<{ content_base64: string; saved_path?: string; filename: string; format?: string; mime_type?: string }>('evidencia_volanteo_render', body),
};
