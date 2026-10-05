import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Code2,
  GitFork,
  Globe,
  Plug,
  Repeat,
  Shuffle,
  Split,
  Wrench,
  Zap,
} from 'lucide-react';
import type { FlowNode, FlowNodeKind, TriggerKind } from './types';

export interface NodeKindDef {
  kind: FlowNodeKind;
  label: string;
  description: string;
  accent: string;
  icon: LucideIcon;
  implemented: boolean;
  inputs: string[];
  outputs: { port: string; label: string }[];
}

export interface SwitchCase {
  value: unknown;
  port: string;
}

export const METHOD_LABELS: Record<string, string> = {
  flows_read_images: 'Tomar imágenes de una carpeta',
  flows_render_pdf: 'Generar PDF desde HTML o plantilla',
  flows_print_pdf: 'Imprimir un PDF',
  flows_printers_list: 'Consultar impresoras instaladas',
  canvas_create: 'Crear un documento de Canvas',
  canvas_duplicate: 'Duplicar una plantilla de Canvas',
  canvas_save: 'Guardar un documento de Canvas',
  canvas_export_cmyk_pdf: 'Generar paneles PDF con Canvas',
  formatos_generate: 'Generar formatos PDF numerados',
  panel_aviso_corte_parse_excel: 'Leer datos de aviso de corte',
  panel_aviso_corte_compute_match: 'Relacionar imágenes y avisos de corte',
  panel_aviso_corte_render_pdf: 'Generar paneles de aviso de corte',
  process_start: 'Convertir y renombrar archivos',
  generar_ubicaciones: 'Generar documentos de ubicaciones',
  evidencia_volanteo_render: 'Generar evidencia de volanteo',
  sellador_apply: 'Sellar un PDF',
  image_optimizer_save_files: 'Guardar imágenes optimizadas',
  db_export: 'Exportar el catálogo',
  technical_reports_create: 'Crear un informe técnico',
  technical_reports_update: 'Actualizar un informe técnico',
  technical_reports_import_file: 'Importar informes técnicos',
  technical_reports_render_html: 'Preparar un informe técnico',
  technical_reports_render_consolidated_html: 'Preparar informes técnicos consolidados',
  informes_v2_create: 'Crear un informe v2',
  informes_v2_update: 'Actualizar un informe v2',
  informes_v2_import_file: 'Importar informes v2',
  informes_v2_render_html: 'Preparar un informe v2',
  informes_v2_render_consolidated_html: 'Preparar informes v2 consolidados',
  fichas_tecnicas_create: 'Crear una ficha técnica',
  fichas_tecnicas_update: 'Actualizar una ficha técnica',
  fichas_tecnicas_import_file: 'Importar fichas técnicas',
  fichas_tecnicas_render_html: 'Preparar una ficha técnica',
  fichas_tecnicas_render_consolidated_html: 'Preparar fichas técnicas consolidadas',
  formats: 'Consultar formatos de imagen disponibles',
  version: 'Consultar versión de Antares',
  canvas_bootstrap: 'Consultar documentos de Canvas',
  canvas_list: 'Listar documentos de Canvas',
  canvas_get: 'Consultar un documento de Canvas',
  canvas_get_history: 'Consultar historial de un documento',
  db_columns: 'Consultar columnas y registros del catálogo',
  db_fields: 'Consultar campos del catálogo',
  diagnostics_snapshot: 'Consultar estado de Antares',
  fichas_tecnicas_get: 'Consultar una ficha técnica',
  fichas_tecnicas_list: 'Listar fichas técnicas',
  formatos_get_template: 'Consultar una plantilla PDF',
  formatos_list: 'Listar formatos PDF',
  flows_get: 'Consultar un flujo',
  flows_list: 'Listar flujos',
  flows_run_status: 'Consultar una ejecución',
  flows_runs_list: 'Listar ejecuciones',
  history_get: 'Consultar una entrada del historial',
  history_list: 'Consultar historial de trabajos',
  informes_v2_get: 'Consultar un informe v2',
  informes_v2_list: 'Listar informes v2',
  process_status: 'Consultar estado de la conversión',
  rename_patterns_get: 'Consultar patrones de renombrado',
  technical_reports_autocomplete_contratista: 'Buscar contratistas',
  technical_reports_autocomplete_cs: 'Buscar códigos de suministro',
  technical_reports_get: 'Consultar un informe técnico',
  technical_reports_list: 'Listar informes técnicos',
  template_get: 'Consultar una plantilla',
  templates_list: 'Listar plantillas',
  theme_get: 'Consultar apariencia de Antares',
  theme_preset: 'Consultar un tema de apariencia',
  theme_presets: 'Listar temas de apariencia',
  flows_create: 'Crear un flujo',
  flows_update: 'Modificar un flujo',
  flows_delete: 'Eliminar un flujo y sus ejecuciones',
  flows_duplicate: 'Duplicar un flujo',
  flows_run: 'Ejecutar un flujo',
};

export const METHOD_FIELDS: Record<string, string[]> = {
  flows_read_images: ['source_folder', 'output_folder', 'expected_images', 'images_per_panel', 'spreadsheet_path'],
  flows_render_pdf: ['template_name', 'contexts', 'localImagePaths', 'context', 'html', 'output_path'],
  flows_print_pdf: ['pdf_path', 'printer_name', 'copies', 'pages', 'duplex', 'quality'],
  canvas_export_cmyk_pdf: ['document', 'contexts', 'localImagePaths', 'outputPath'],
  formatos_generate: ['format_id', 'desde', 'hasta', 'output_path'],
  panel_aviso_corte_compute_match: ['rows', 'key_column', 'image_names'],
  panel_aviso_corte_render_pdf: ['panels', 'image_paths', 'template_id', 'output_path'],
  process_start: ['files', 'destino', 'formato'],
  technical_reports_render_html: ['id'], informes_v2_render_html: ['id'], fichas_tecnicas_render_html: ['id'],
  sellador_apply: ['pdf_path', 'stamp_path', 'stamp_count', 'output_path'],
  generar_ubicaciones: ['excelPath', 'outputDir'],
  canvas_get: ['id'], canvas_get_history: ['id'], flows_get: ['id'],
  flows_run_status: ['run_id'], history_get: ['id'], fichas_tecnicas_get: ['id'],
  informes_v2_get: ['id'], technical_reports_get: ['id'],
  formatos_get_template: ['format_id'], template_get: ['name'],
};

export function nodeOutputs(flowNode: FlowNode): { port: string; label: string }[] {
  if (flowNode.kind === 'switch') {
    const cases = Array.isArray(flowNode.config.cases) ? (flowNode.config.cases as SwitchCase[]) : [];
    const outs = cases
      .filter((c) => c && typeof c.port === 'string' && c.port)
      .map((c, i) => ({ port: c.port, label: `Caso ${i + 1}` }));
    outs.push({ port: 'default', label: 'Defecto' });
    return outs;
  }
  return NODE_KIND_DEFS[flowNode.kind].outputs;
}

export const NODE_KIND_DEFS: Record<FlowNodeKind, NodeKindDef> = {
  trigger: {
    kind: 'trigger',
    label: 'Disparador',
    description: 'Punto de entrada del flujo',
    accent: 'var(--accent-primary, #6366f1)',
    icon: Zap,
    implemented: true,
    inputs: [],
    outputs: [{ port: 'main', label: 'Salida' }],
  },
  tool_call: {
    kind: 'tool_call',
    label: 'Acción',
    description: 'Genera documentos, procesa archivos o consulta Antares',
    accent: '#38bdf8',
    icon: Wrench,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Resultado' }],
  },
  condition: {
    kind: 'condition',
    label: 'Condición',
    description: 'Elige el siguiente paso según una comparación',
    accent: '#f59e0b',
    icon: GitFork,
    implemented: true,
    inputs: ['main'],
    outputs: [
      { port: 'true', label: 'Sí' },
      { port: 'false', label: 'No' },
    ],
  },
  transform: {
    kind: 'transform',
    label: 'Transformar',
    description: 'Prepara campos para el resultado',
    accent: '#34d399',
    icon: Shuffle,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Objeto' }],
  },
  loop: {
    kind: 'loop',
    label: 'Bucle',
    description: 'Repite pasos por cada elemento',
    accent: '#a78bfa',
    icon: Repeat,
    implemented: true,
    inputs: ['main'],
    outputs: [
      { port: 'each', label: 'Cada elemento' },
      { port: 'done', label: 'Al terminar' },
    ],
  },
  http_request: {
    kind: 'http_request',
    label: 'HTTP',
    description: 'Consulta o envía datos a una dirección web',
    accent: '#fb7185',
    icon: Globe,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Respuesta' }],
  },
  agent: {
    kind: 'agent',
    label: 'Agente IA',
    description: 'Redacta o analiza datos con IA',
    accent: '#e879f9',
    icon: Bot,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Texto' }],
  },
  switch: {
    kind: 'switch',
    label: 'Distribuir',
    description: 'Elige distintos caminos según los datos',
    accent: '#fbbf24',
    icon: Split,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'default', label: 'Defecto' }],
  },
  mcp_call: {
    kind: 'mcp_call',
    label: 'Llamada MCP',
    description: 'Usa una herramienta de un servidor conectado',
    accent: '#2dd4bf',
    icon: Plug,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Resultado' }],
  },
  code: {
    kind: 'code',
    label: 'Código',
    description: 'Ejecuta un pequeño script en Python',
    accent: '#94a3b8',
    icon: Code2,
    implemented: true,
    inputs: ['main'],
    outputs: [{ port: 'main', label: 'Salida' }],
  },
};

export const PALETTE_KINDS: FlowNodeKind[] = [
  'tool_call',
  'condition',
  'switch',
  'transform',
  'loop',
  'http_request',
  'agent',
  'mcp_call',
  'code',
];

export const TRIGGER_KIND_LABELS: Record<TriggerKind, string> = {
  manual: 'Manual',
  schedule: 'Programado',
  app_event: 'Evento de la app',
  webhook: 'Webhook',
};

export const ENABLED_TRIGGER_KINDS: TriggerKind[] = ['manual', 'schedule', 'app_event', 'webhook'];

export const CONDITION_OPS: { value: string; label: string }[] = [
  { value: 'eq', label: 'es igual a' },
  { value: 'neq', label: 'es distinto de' },
  { value: 'gt', label: 'es mayor que' },
  { value: 'gte', label: 'es mayor o igual que' },
  { value: 'lt', label: 'es menor que' },
  { value: 'lte', label: 'es menor o igual que' },
  { value: 'contains', label: 'contiene' },
  { value: 'exists', label: 'existe' },
];
