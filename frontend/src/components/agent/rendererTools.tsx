import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { agentApi } from '../../api/agentApi';
import { getAgentCanvasEditor } from './canvasEditor';
import type { CanvasDocument } from '../canvas/types';
import type { BoardColumnInput, TareaInput } from '../espacios/types';

type Data = Record<string, unknown>;
function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Indica los datos del documento');
  return value as Data;
}
function text(value: unknown): string { return value == null ? '' : String(value); }
function rows(value: unknown, max = 200): Data[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error(`Indica entre 1 y ${max} filas`);
  return value.map(object);
}
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function exportPadron(params: Data) {
  const data = await import('../padron/data');
  const format = text(params.format || 'service-interruption');
  if (!data.OUTPUT_FORMAT_OPTIONS.some((item) => item.value === format)) throw new Error('Formato de Padrón inválido');
  const orientation = text(params.orientation || 'landscape');
  if (!['landscape', 'portrait'].includes(orientation)) throw new Error('Orientación inválida');
  const header = object(params.header);
  const water = format === 'water-cut-notice';
  const fields = water ? data.WATER_CUT_FIELDS : data.HEADER_FIELDS;
  const missing = fields.filter((field) => field.required && !text(header[field.key]).trim());
  if (missing.length) throw new Error(`Faltan datos: ${missing.map((field) => field.label).join(', ')}`);
  const raw = rows(params.rows, data.MAX_PADRON_ITEMS);
  const items = raw.map((row, i) => Object.fromEntries(Object.entries({ ...row, item: row.item ?? i + 1 }).map(([key, value]) => [key, text(value)])));
  if (items.some((row) => !row.nombresApellidos || !row.direccion)) throw new Error('Completa nombres y dirección en cada fila');
  const folio = Number(params.folio_start ?? 1);
  if (!Number.isInteger(folio) || folio < 1) throw new Error('Folio inicial inválido');
  await import('../padron/vpad-styles.css');
  const { default: PreviewPage } = await import('../padron/PreviewPage');
  const { default: WaterCutNoticePage } = await import('../padron/WaterCutNoticePage');
  const { chunkArray, paginateLuriganchoItems, loadImageAsBase64, canvasToJpegBytes, getRenderableExportSheets } = await import('../padron/pdfHelpers');
  const { resolveRowsPerPage, resolvePreviewVariant } = await import('../padron/previewMath');
  const logoA = await import('../../assets/padron-assets/logo_acciona.webp');
  const logoS = await import('../../assets/padron-assets/logo_sedapal.webp');
  const [accionaLogo, sedapalLogo] = await Promise.all([loadImageAsBase64(logoA.default), loadImageAsBase64(logoS.default)]);
  const typedOrientation = orientation as 'portrait' | 'landscape';
  const typedFormat = format as import('../padron/data').OutputFormat;
  const pages = format.startsWith('volante') ? paginateLuriganchoItems(items as unknown as import('../padron/data').PadronItem[], typedOrientation)
    : chunkArray(items, resolveRowsPerPage(typedFormat, typedOrientation));
  const landscape = !water && orientation === 'landscape';
  const { default: JsPDF } = await import('jspdf');
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true });
  const { toCanvas, getFontEmbedCSS } = await import('html-to-image');
  const host = document.createElement('div');
  host.className = 'vpad-pdf-export-root vpad-export-mode';
  host.style.cssText = `position:fixed;left:-200vw;top:0;width:${landscape ? 1123 : 794}px;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await document.fonts?.ready;
    for (let i = 0; i < pages.length; i++) {
      const common = { headerData: header as Record<string, string>, sedapalLogo, pageNumber: folio + i, totalPages: folio + pages.length - 1 };
      flushSync(() => root.render(<div data-pdf-page={i}>{water
        ? <WaterCutNoticePage {...common} headerData={header as unknown as import('../padron/data').WaterCutData} items={pages[i] as unknown as import('../padron/data').WaterCutItem[]} />
        : <PreviewPage {...common} items={pages[i] as unknown as import('../padron/data').PadronItem[]} orientation={typedOrientation} accionaLogo={accionaLogo}
            isFirstPage={i === 0} isLastPage={i === pages.length - 1} variant={resolvePreviewVariant(typedFormat)} />}</div>));
      await settle();
      const target = getRenderableExportSheets(host)[0];
      if (!target?.offsetWidth) throw new Error('No se pudo medir la página del Padrón');
      const width = landscape ? 297 : 210;
      const height = landscape ? 210 : 297;
      const pixelRatio = Math.round(width * 3.7795 * 2) / target.offsetWidth;
      const canvas = await toCanvas(target, { backgroundColor: '#ffffff', pixelRatio, width: target.offsetWidth,
        height: target.offsetHeight, fontEmbedCSS: await getFontEmbedCSS(target, { preferredFontFormat: 'woff2' }) });
      if (i) pdf.addPage();
      pdf.addImage(await canvasToJpegBytes(canvas, 0.92), 'JPEG', 0, 0, width, height);
    }
    return { pdf_base64: pdf.output('datauristring').split(',')[1], count: pages.length, module: 'padron', template_revision: 'padron-v1' };
  } finally { root.unmount(); host.remove(); }
}

async function exportVolantes(params: Data) {
  const raw = rows(params.rows);
  const required = ['distrito', 'fecha', 'horaInicio', 'horaFin', 'reservorio'];
  if (raw.some((row) => required.some((key) => !text(row[key]).trim()))) throw new Error('Completa distrito, fecha, horarios y reservorio en cada fila');
  const layout = text(params.layout || '2-up');
  if (!['2-up', '3-up'].includes(layout)) throw new Error('Formato de Volantes inválido');
  const records = raw.map((row, i) => ({ ...row, id: text(row.id || `agent-${i}`), sector: text(row.sector), zonasAfectadas: text(row.zonasAfectadas) })) as import('../volantes/types').FlyerRecord[];
  await import('../volantes/styles.css');
  const { default: SheetPreview } = await import('../volantes/components/SheetPreview');
  const { DEFAULT_BRAND, DEFAULT_FOOTER, DEFAULT_HEADING, DEFAULT_ENCABEZADOS } = await import('../volantes/constants');
  const { loadVolantesDraft } = await import('../volantes/utils/storage');
  const configuration = await loadVolantesDraft();
  const { chunkExportItems, appendPagesToPdf, createPdfDocument, PDF_EXPORT_BATCH_SIZE } = await import('../volantes/utils/pdf');
  const host = document.createElement('div');
  host.className = 'sheet-export-root';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const pdf = await createPdfDocument();
    const batches = chunkExportItems(records, PDF_EXPORT_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      flushSync(() => root.render(<SheetPreview brand={configuration?.brand ?? DEFAULT_BRAND} footer={configuration?.footer ?? DEFAULT_FOOTER}
        heading={configuration?.heading ?? DEFAULT_HEADING} encabezados={configuration?.encabezados ?? DEFAULT_ENCABEZADOS}
        layoutMode={layout as '2-up' | '3-up'} records={batches[i]} exportMode />));
      await appendPagesToPdf(host, pdf, i > 0);
    }
    return { pdf_base64: pdf.output('datauristring').split(',')[1], count: records.length, module: 'volantes', template_revision: 'volantes-v1' };
  } finally { root.unmount(); host.remove(); }
}

async function spaces(method: string, params: Data): Promise<unknown> {
  const { supabase } = await import('../../lib/supabase');
  if (!supabase) throw new Error('Configura Espacios e inicia sesión para usar esta función');
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Inicia sesión en Espacios para usar esta función');
  if (params._expected_account_id && params._expected_account_id !== data.user.id) throw new Error('La cuenta cambió después de aprobar');
  if (method === 'espacios_context') return { account_id: data.user.id, account: data.user.email || data.user.id };
  const api = await import('../espacios/api/espaciosApi');
  const send = async <T,>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (failure.name !== 'TareaConflictError' && !/\[(?:[A-Z0-9]{5}|PGRST\d+)\]$/.test(failure.message)
        && !/no se guardaron los cambios|Prioridad de tarea no válida/.test(failure.message)) {
        failure.name = 'AgentEffectUncertainError';
      }
      throw failure;
    }
  };
  const id = text(params.id);
  if (method === 'espacios_list') return api.fetchEspacios();
  if (method === 'espacios_members') return api.fetchTeamMembers();
  if (method === 'espacios_my_tasks') return api.fetchMyTasks();
  if (method === 'espacios_my_task_origins') return api.fetchMyTaskOrigins();
  if (!id && !method.endsWith('espacio_create')) throw new Error('Indica el recurso de Espacios');
  if (method === 'espacios_projects') return api.fetchProyectos(id);
  if (method === 'espacios_tasks') return api.fetchTareas(id);
  if (method === 'espacios_task_get') return api.fetchTarea(id);
  if (method === 'espacios_task_comments') return api.fetchTaskComments(id);
  if (method === 'espacios_task_activity') return api.fetchTaskActivity(id);
  if (method === 'espacios_columns') return send(() => api.fetchBoardColumns(id));
  if (method === 'espacios_espacio_delete') { await send(() => api.deleteEspacio(id)); return { deleted: true, id }; }
  if (method === 'espacios_proyecto_delete') { await send(() => api.deleteProyecto(id)); return { deleted: true, id }; }
  if (method === 'espacios_tarea_delete') { await send(() => api.deleteTarea(id)); return { deleted: true, id }; }
  if (method === 'espacios_column_delete') { await send(() => api.deleteBoardColumn(id)); return { deleted: true, id }; }
  if (method === 'espacios_comment_create') {
    if (!text(params.body).trim()) throw new Error('Escribe el comentario antes de guardarlo');
    return send(() => api.createTaskComment(id, text(params.body), data.user.id));
  }
  const input = object(params.input);
  if (method.endsWith('_create') && !text(input[method.includes('_tarea_') ? 'title' : 'name']).trim()) {
    throw new Error('Completa el nombre o título antes de crear el recurso');
  }
  const allowed = method.includes('_tarea_') ? ['title', 'description', 'status', 'priority', 'assignee_id', 'start_date', 'due_date', 'sort_order']
    : method.includes('_column_') ? ['name', 'color', 'sort_order', 'is_done'] : ['name', 'color', 'is_favorite'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Campo de Espacios no permitido');
  if (method === 'espacios_espacio_create') return send(() => api.createEspacio(text(input.name), data.user.id, input.color == null ? undefined : text(input.color)));
  if (method === 'espacios_espacio_update') return send(() => api.updateEspacio(id, input));
  if (method === 'espacios_proyecto_create') return send(() => api.createProyecto(id, text(input.name), input.color == null ? undefined : text(input.color)));
  if (method === 'espacios_proyecto_update') return send(() => api.updateProyecto(id, input));
  if (method === 'espacios_column_create') return send(async () => api.createBoardColumn(id, input as unknown as BoardColumnInput, await api.fetchBoardColumns(id)));
  if (method === 'espacios_column_update') return send(() => api.updateBoardColumn(id, input));
  if (method === 'espacios_tarea_create') return send(() => api.createTarea(id, input as unknown as TareaInput, data.user.id));
  if (method === 'espacios_tarea_update') {
    if (!params.expected_updated_at) throw new Error('Consulta la revisión de la tarea antes de modificarla');
    return send(() => api.updateTarea(id, input, text(params.expected_updated_at)));
  }
  throw new Error('Función de Espacios no disponible');
}

export async function executeRendererTool(method: string, params: Data): Promise<unknown> {
  if (method.startsWith('espacios_')) return spaces(method, params);
  if (method === 'padron_describe') {
    const data = await import('../padron/data');
    return { fields: data.HEADER_FIELDS, water_cut_fields: data.WATER_CUT_FIELDS, formats: data.OUTPUT_FORMAT_OPTIONS,
      row_fields: ['item', 'nombresApellidos', 'direccion', 'horaComunicacion', 'firmaSuministro'],
      water_cut_row_fields: ['item', 'hora', 'fecha', 'nombresApellidos', 'direccion', 'dni', 'firma', 'observaciones'] };
  }
  if (method === 'volantes_describe') return { required: ['distrito', 'fecha', 'horaInicio', 'horaFin', 'reservorio'],
    optional: ['sector', 'zonasAfectadas'], layouts: ['2-up', '3-up'] };
  if (method === 'padron_export_pdf') return exportPadron(params);
  if (method === 'volantes_export_pdf') return exportVolantes(params);
  if (method === 'document_render') {
    const { mergeCanvasHtmlDocuments } = await import('../canvas/runtime/renderHtml');
    if (Array.isArray(params.htmls)) return { html: mergeCanvasHtmlDocuments(params.htmls.map(text)) };
    const doc = params.document as CanvasDocument;
    const editor = getAgentCanvasEditor();
    if (editor?.get().id === doc.id && editor.dirty()) throw new Error('La plantilla está abierta con cambios sin guardar; guárdala o conserva otra revisión antes de generar');
    const { prepareDocumentImagesForExport } = await import('../canvas/utils/imageBlobStore');
    const { renderMultiPageHtml } = await import('../canvas/runtime/planning');
    const prepared = await prepareDocumentImagesForExport(doc, { mode: 'rgb' });
    const contexts = rows(params.contexts);
    return { html: mergeCanvasHtmlDocuments(contexts.map((ctx) => renderMultiPageHtml(prepared, {
      data: object(ctx.data) as Record<string, string>, images: Array.isArray(ctx.images) ? ctx.images.map(text) : [], logoLeft: null, logoRight: null,
    }))) };
  }
  if (method === 'canvas_fill_fields' || method === 'canvas_apply_layers') {
    const editor = getAgentCanvasEditor();
    if (editor?.get().id === text(params.id)) {
      if (editor.dirty()) throw new Error('Canvas tiene cambios sin guardar; conserva o guarda tu edición antes de aprobar otra versión');
      if (method === 'canvas_apply_layers') return editor.applyLayers(params);
      return editor.apply(object(params.values), text(params.expected_updated_at));
    }
    return method === 'canvas_apply_layers' ? agentApi.agentCanvasApplyLayers(params) : agentApi.agentCanvasFill(params);
  }
  throw new Error('Función de Agent no disponible en la pantalla');
}
