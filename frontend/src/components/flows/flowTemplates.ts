import type { WorkflowGraph } from './types';

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  requirements: string;
  graph: WorkflowGraph;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'formatos-locales',
    name: 'Ver formatos disponibles',
    description: 'Pulsa Ejecutar para consultar los formatos que admite Antares y ver el resultado en Ejecuciones.',
    requirements: 'Listo para usar. Sin cuentas ni claves.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Inicio manual', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        { id: 'datos', kind: 'tool_call', name: 'Ver formatos disponibles', config: { method: 'formats' }, position: { x: 300, y: 0 } },
      ],
      edges: [{ from_node: 'trigger', to_node: 'datos', from_port: 'main', to_port: 'main' }],
    },
  },
  {
    id: 'clasicficador-ia',
    requirements: 'Requiere configurar un proveedor IA.',
    name: 'Clasificador con IA',
    description:
      'Manual → consulta datos → el agente IA los clasifica → cada categoría a su transformación.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Disparador', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        {
          id: 'datos',
          kind: 'tool_call',
          name: 'Obtener datos',
          config: { method: 'formats' },
          position: { x: 260, y: 0 },
        },
        {
          id: 'ia',
          kind: 'agent',
          name: 'Clasificar',
          config: {
            provider: '',
            prompt: 'Clasifica el contenido en una palabra (alto, medio, bajo): {{ =nodes.datos.json }}',
          },
          position: { x: 520, y: 0 },
        },
        {
          id: 'sw',
          kind: 'switch',
          name: 'Distribuir',
          config: {
            field: '=nodes.ia.json.text',
            cases: [
              { value: 'alto', port: 'caso_1' },
              { value: 'medio', port: 'caso_2' },
            ],
          },
          position: { x: 780, y: 0 },
        },
        {
          id: 'alto',
          kind: 'transform',
          name: 'Alta',
          config: { output: { prioridad: 'alta', texto: '=nodes.ia.json.text' } },
          position: { x: 1040, y: -110 },
        },
        {
          id: 'bajo',
          kind: 'transform',
          name: 'Resto',
          config: { output: { prioridad: 'normal', texto: '=nodes.ia.json.text' } },
          position: { x: 1040, y: 110 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'datos', from_port: 'main', to_port: 'main' },
        { from_node: 'datos', to_node: 'ia', from_port: 'main', to_port: 'main' },
        { from_node: 'ia', to_node: 'sw', from_port: 'main', to_port: 'main' },
        { from_node: 'sw', to_node: 'alto', from_port: 'caso_1', to_port: 'main' },
        { from_node: 'sw', to_node: 'bajo', from_port: 'default', to_port: 'main' },
      ],
    },
  },
  {
    id: 'http-programado',
    requirements: 'Requiere sustituir la dirección de ejemplo. Se ejecuta con Antares abierto.',
    name: 'Sonda HTTP programada',
    description: 'Programado → llama una API → si responde mal, reintenta y lo registra.',
    graph: {
      nodes: [
        {
          id: 'trigger',
          kind: 'trigger',
          name: 'Disparador',
          config: { trigger_kind: 'schedule', interval_minutes: 60 },
          position: { x: 0, y: 0 },
        },
        {
          id: 'http',
          kind: 'http_request',
          name: 'Sondear API',
          config: {
            url: 'https://api.ejemplo.com/estado',
            method: 'GET',
            retry: { attempts: 3, delay_ms: 1000 },
          },
          position: { x: 260, y: 0 },
        },
        {
          id: 'cond',
          kind: 'condition',
          name: '¿Respondió bien?',
          config: { field: '=nodes.http.json.ok', op: 'eq', value: true },
          position: { x: 520, y: 0 },
        },
        {
          id: 'ok',
          kind: 'transform',
          name: 'Estado correcto',
          config: { output: { estado: 'ok', codigo: '=nodes.http.json.status' } },
          position: { x: 780, y: -100 },
        },
        {
          id: 'bad',
          kind: 'transform',
          name: 'Estado con error',
          config: { output: { estado: 'fallo', codigo: '=nodes.http.json.status' } },
          position: { x: 780, y: 100 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'http', from_port: 'main', to_port: 'main' },
        { from_node: 'http', to_node: 'cond', from_port: 'main', to_port: 'main' },
        { from_node: 'cond', to_node: 'ok', from_port: 'true', to_port: 'main' },
        { from_node: 'cond', to_node: 'bad', from_port: 'false', to_port: 'main' },
      ],
    },
  },
  {
    id: 'informe-ia',
    requirements: 'Requiere configurar un proveedor IA.',
    name: 'Informe con IA',
    description: 'Manual → reúne formatos → el agente redacta un resumen en texto.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Disparador', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        {
          id: 'datos',
          kind: 'tool_call',
          name: 'Datos',
          config: { method: 'formats' },
          position: { x: 260, y: 0 },
        },
        {
          id: 'ia',
          kind: 'agent',
          name: 'Redactar informe',
          config: {
            provider: '',
            system: 'Eres un redactor técnico conciso. Responde en español.',
            prompt: 'Redacta un breve informe con estos datos: {{ =nodes.datos.json }}',
          },
          position: { x: 520, y: 0 },
        },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'datos', from_port: 'main', to_port: 'main' },
        { from_node: 'datos', to_node: 'ia', from_port: 'main', to_port: 'main' },
      ],
    },
  },
  {
    id: 'paneles-canvas', name: 'Imágenes → paneles de Canvas',
    description: 'Espera imágenes y datos completos, aplica una plantilla de Canvas y guarda los paneles PDF automáticamente.',
    requirements: 'Elige una plantilla, las carpetas de origen y salida y cuántas imágenes necesitas. Antares debe permanecer abierto.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Revisar entradas', config: { trigger_kind: 'schedule', interval_minutes: 1 }, position: { x: 0, y: 0 } },
        { id: 'plantilla', kind: 'tool_call', name: 'Plantilla de Canvas', config: { method: 'canvas_get', args: { id: '' }, required_args: ['id'] }, position: { x: 260, y: 0 } },
        { id: 'imagenes', kind: 'tool_call', name: 'Imágenes y datos', config: { method: 'flows_read_images', args: { source_folder: '', output_folder: '', expected_images: 1, images_per_panel: 1 }, required_args: ['source_folder', 'output_folder'] }, position: { x: 520, y: 0 } },
        { id: 'generar', kind: 'tool_call', name: 'Guardar paneles PDF', config: { method: 'canvas_export_cmyk_pdf', args: { document: '=nodes.plantilla.json.document', contexts: '=nodes.imagenes.json.contexts', localImagePaths: '=nodes.imagenes.json.localImagePaths', outputPath: '=nodes.imagenes.json.output_path' } }, position: { x: 780, y: 0 } },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'plantilla', from_port: 'main', to_port: 'main' },
        { from_node: 'plantilla', to_node: 'imagenes', from_port: 'main', to_port: 'main' },
        { from_node: 'imagenes', to_node: 'generar', from_port: 'main', to_port: 'main' },
      ],
    },
  },
  {
    id: 'paneles-aviso-corte', name: 'Imágenes y Excel → aviso de corte',
    description: 'Espera el Excel y las imágenes, relaciona cada registro por ID y genera los paneles PDF.',
    requirements: 'Selecciona las carpetas, el Excel y la columna ID. Antares debe permanecer abierto.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Revisar entradas', config: { trigger_kind: 'schedule', interval_minutes: 1 }, position: { x: 0, y: 0 } },
        { id: 'imagenes', kind: 'tool_call', name: 'Imágenes y Excel', config: { method: 'flows_read_images', args: { source_folder: '', output_folder: '', spreadsheet_path: '', key_column: 'ID', expected_images: 1, images_per_panel: 1 }, required_args: ['source_folder', 'output_folder', 'spreadsheet_path'] }, position: { x: 260, y: 0 } },
        { id: 'relacionar', kind: 'tool_call', name: 'Asociar registros', config: { method: 'panel_aviso_corte_compute_match', args: { rows: '=nodes.imagenes.json.rows', image_names: '=nodes.imagenes.json.image_names', key_column: '=nodes.imagenes.json.key_column' } }, position: { x: 520, y: 0 } },
        { id: 'generar', kind: 'tool_call', name: 'Guardar avisos de corte', config: { method: 'panel_aviso_corte_render_pdf', args: { panels: '=nodes.relacionar.json.panels', image_paths: '=nodes.imagenes.json.image_paths', output_path: '=nodes.imagenes.json.output_path' } }, position: { x: 780, y: 0 } },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'imagenes', from_port: 'main', to_port: 'main' },
        { from_node: 'imagenes', to_node: 'relacionar', from_port: 'main', to_port: 'main' },
        { from_node: 'relacionar', to_node: 'generar', from_port: 'main', to_port: 'main' },
      ],
    },
  },
  {
    id: 'generar-formatos', name: 'Generar formatos PDF',
    description: 'Genera un rango de documentos numerados con cualquiera de tus formatos PDF.',
    requirements: 'Selecciona el formato, los números inicial y final y un archivo de salida.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Inicio manual', config: { trigger_kind: 'manual' }, position: { x: 0, y: 0 } },
        { id: 'generar', kind: 'tool_call', name: 'Generar documentos', config: { method: 'formatos_generate', args: { format_id: '', desde: 1, hasta: 1, output_path: '' }, required_args: ['format_id', 'output_path'] }, position: { x: 300, y: 0 } },
      ],
      edges: [{ from_node: 'trigger', to_node: 'generar', from_port: 'main', to_port: 'main' }],
    },
  },
  {
    id: 'convertir-carpeta', name: 'Carpeta → imágenes convertidas',
    description: 'Convierte las imágenes de una carpeta al formato elegido cuando el lote está completo.',
    requirements: 'Selecciona origen, destino y cantidad de imágenes. Puedes cambiar el formato en el último paso.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Revisar entradas', config: { trigger_kind: 'schedule', interval_minutes: 1 }, position: { x: 0, y: 0 } },
        { id: 'imagenes', kind: 'tool_call', name: 'Esperar imágenes', config: { method: 'flows_read_images', args: { source_folder: '', output_folder: '', expected_images: 1, images_per_panel: 1 } }, position: { x: 260, y: 0 } },
        { id: 'convertir', kind: 'tool_call', name: 'Convertir imágenes', config: { method: 'process_start', args: { files: '=nodes.imagenes.json.files', destino: '=nodes.imagenes.json.output_folder', formato: 'png' } }, position: { x: 520, y: 0 } },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'imagenes', from_port: 'main', to_port: 'main' },
        { from_node: 'imagenes', to_node: 'convertir', from_port: 'main', to_port: 'main' },
      ],
    },
  },
  {
    id: 'plantilla-sellar-imprimir', name: 'Plantilla → PDF → sellado → impresión',
    description: 'Espera imágenes y datos, genera el PDF con una plantilla de Antares, lo sella y lo envía a la impresora.',
    requirements: 'Selecciona carpetas, plantilla, imagen del sello e impresora. Puedes conectar datos de informes o fichas en el paso de generación. Antares debe permanecer abierto.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Revisar entradas', config: { trigger_kind: 'schedule', interval_minutes: 1 }, position: { x: 0, y: 0 } },
        { id: 'imagenes', kind: 'tool_call', name: 'Imágenes y datos', config: { method: 'flows_read_images', args: { source_folder: '', output_folder: '', expected_images: 1, images_per_panel: 1 }, required_args: ['source_folder', 'output_folder'] }, position: { x: 260, y: 0 } },
        { id: 'generar', kind: 'tool_call', name: 'Generar PDF de plantilla', config: { method: 'flows_render_pdf', args: { template_name: '', contexts: '=nodes.imagenes.json.contexts', localImagePaths: '=nodes.imagenes.json.localImagePaths', output_path: '=nodes.imagenes.json.output_path' }, required_args: ['template_name'] }, position: { x: 520, y: 0 } },
        { id: 'sellar', kind: 'tool_call', name: 'Sellar PDF generado', config: { method: 'sellador_apply', args: { pdf_path: '=nodes.generar.json.saved_path', stamp_path: '', stamp_count: 1, output_path: '=nodes.imagenes.json.stamped_output_path' }, required_args: ['stamp_path'] }, position: { x: 780, y: 0 } },
        { id: 'imprimir', kind: 'tool_call', name: 'Imprimir PDF sellado', config: { method: 'flows_print_pdf', args: { pdf_path: '=nodes.sellar.json.saved_path', printer_name: '', copies: 1 }, required_args: ['printer_name'] }, position: { x: 1040, y: 0 } },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'imagenes', from_port: 'main', to_port: 'main' },
        { from_node: 'imagenes', to_node: 'generar', from_port: 'main', to_port: 'main' },
        { from_node: 'generar', to_node: 'sellar', from_port: 'main', to_port: 'main' },
        { from_node: 'sellar', to_node: 'imprimir', from_port: 'main', to_port: 'main' },
      ],
    },
  },
  {
    id: 'reportes-excel', name: 'Excel y fotos → reporte consolidado',
    description: 'Genera un único PDF con cualquier plantilla HTML de Antares. Asocia fotos por OT y fecha, reutiliza el mapeo y evita generar dos veces el mismo lote.',
    requirements: 'Selecciona un Excel común y las carpetas de origen y salida. Revisa el mapeo y las fotos en la vista previa. Activa el flujo para generar automáticamente con Antares abierto; también puedes ejecutarlo manualmente.',
    graph: {
      nodes: [
        { id: 'trigger', kind: 'trigger', name: 'Revisar lote completo', config: { trigger_kind: 'schedule', interval_minutes: 1 }, position: { x: 0, y: 0 } },
        { id: 'imagenes', kind: 'tool_call', name: 'Excel y fotos por OT y fecha', config: { method: 'flows_read_images', args: { report_template: 'report.html', source_folder: '', output_folder: '', spreadsheet_path: '', images_per_panel: 6, field_mappings: {} }, required_args: ['source_folder', 'output_folder', 'spreadsheet_path'] }, position: { x: 300, y: 0 } },
        { id: 'generar', kind: 'tool_call', name: 'Guardar PDF consolidado', config: { method: 'flows_render_pdf', args: { template_name: '=nodes.imagenes.json.template_name', contexts: '=nodes.imagenes.json.contexts', localImagePaths: '=nodes.imagenes.json.localImagePaths', photo_digests: '=nodes.imagenes.json.photo_digests', expected_pages: '=nodes.imagenes.json.expected_pages', output_path: '=nodes.imagenes.json.output_path' } }, position: { x: 600, y: 0 } },
      ],
      edges: [
        { from_node: 'trigger', to_node: 'imagenes', from_port: 'main', to_port: 'main' },
        { from_node: 'imagenes', to_node: 'generar', from_port: 'main', to_port: 'main' },
      ],
    },
  },
];
