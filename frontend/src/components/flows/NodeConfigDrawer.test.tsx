import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { flowsApi } from '../../api/flowsApi';
import { connectionsApi } from '../../api/connectionsApi';
import { systemApi } from '../../api/systemApi';
import { canvasApi } from '../../api/canvasApi';
import { toolsApi } from '../../api/toolsApi';
import NodeConfigDrawer from './NodeConfigDrawer';
import type { FlowNode } from './types';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: [] });
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({ providers: [] });
  vi.spyOn(toolsApi, 'templatesList').mockResolvedValue({ templates: [
    { id: 'report', name: 'report.html', filename: 'report.html', source: 'html' },
    { id: 'certificado', name: 'certificados-sjl-blanco.html', filename: 'certificados-sjl-blanco.html', source: 'html' },
  ] });
});

it('permite reconverger ramas sin modificar los argumentos de la acción', async () => {
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: ['canvas_create'], actions: ['canvas_create'] });
  const changed = vi.fn();
  render(<NodeConfigDrawer node={{ id: 'action', name: 'Crear', kind: 'tool_call', position: { x: 0, y: 0 }, config: { method: 'canvas_create', args: { name: 'Panel' } } }} onChange={changed} onDelete={vi.fn()} onClose={vi.fn()} />);
  const select = await screen.findByRole('button', { name: 'Entradas conectadas' });
  expect(select).toHaveTextContent('Esperar todas las entradas');
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'Aceptar cualquier rama activa' }));
  expect(changed.mock.lastCall?.[0].config).toEqual({ method: 'canvas_create', args: { name: 'Panel' }, input_mode: 'any' });
});

it('permite tratar un error HTTP como datos manteniendo el timeout', async () => {
  const changed = vi.fn();
  render(<NodeConfigDrawer node={{ id: 'http', name: 'HTTP', kind: 'http_request', position: { x: 0, y: 0 }, config: { url: 'https://example.com', timeout_s: 12 } }} onChange={changed} onDelete={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByText('Opciones avanzadas de la solicitud'));
  fireEvent.click(screen.getByRole('button', { name: 'Ante un error HTTP' }));
  fireEvent.click(screen.getByRole('option', { name: 'Continuar y consultar la respuesta' }));
  expect(changed.mock.lastCall?.[0].config).toEqual({ url: 'https://example.com', timeout_s: 12, fail_on_http_error: false });
});

it('configura la entrada de imágenes con carpetas elegidas y cantidades numéricas', async () => {
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: ['flows_read_images'], actions: ['flows_read_images'] });
  const folder = vi.spyOn(systemApi, 'dialogFolder').mockResolvedValue({ paths: [], file_tokens: [], folder: 'C:\\imagenes' });
  const changed = vi.fn();
  function Source() {
    const [node, setNode] = useState<FlowNode>({ id: 'source', kind: 'tool_call', name: 'Imágenes', position: { x: 0, y: 0 }, config: { method: 'flows_read_images', args: { expected_images: 1, images_per_panel: 1 } } });
    return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Source />);
  fireEvent.click(screen.getByRole('button', { name: 'Seleccionar origen' }));
  await waitFor(() => expect(screen.getByLabelText('source_folder')).toHaveValue('C:\\imagenes'));
  expect(folder).toHaveBeenCalledWith({ pickOnly: true, title: 'Carpeta de imágenes' });
  fireEvent.change(screen.getByLabelText('expected_images'), { target: { value: '4' } });
  expect(changed.mock.lastCall?.[0].config.args.expected_images).toBe(4);
  expect(screen.getByText(/Espera el lote completo/)).toBeVisible();
});

it('permite seleccionar una plantilla de Canvas guardada', async () => {
  vi.spyOn(canvasApi, 'canvasList').mockResolvedValue({ documents: [{ id: 'plantilla-a', name: 'Panel de campo' }] } as Awaited<ReturnType<typeof canvasApi.canvasList>>);
  const changed = vi.fn();
  render(<NodeConfigDrawer node={{ id: 'template', kind: 'tool_call', name: 'Plantilla', position: { x: 0, y: 0 }, config: { method: 'canvas_get', args: { id: '' } } }} onChange={changed} onDelete={vi.fn()} onClose={vi.fn()} />);
  const select = await screen.findByRole('button', { name: 'Plantilla guardada' });
  fireEvent.click(select);
  fireEvent.click(screen.getByText('Panel de campo'));
  expect(changed.mock.lastCall?.[0].config.args.id).toBe('plantilla-a');
});

it('incluye las plantillas de las subcarpetas de informes y fichas', async () => {
  const list = vi.spyOn(toolsApi, 'templatesList').mockResolvedValue({ templates: [
    { id: 'ficha_tecnica', name: 'fichas_tecnicas/ficha_tecnica.html', filename: 'fichas_tecnicas/ficha_tecnica.html', source: 'html' },
  ] });
  const changed = vi.fn();
  render(<NodeConfigDrawer node={{ id: 'pdf', kind: 'tool_call', name: 'Generar', position: { x: 0, y: 0 }, config: { method: 'flows_render_pdf', args: {} } }} onChange={changed} onDelete={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Plantilla guardada' }));
  fireEvent.click(screen.getByText('fichas_tecnicas/ficha_tecnica.html'));
  expect(list).toHaveBeenCalledWith({ recursive: true });
  expect(changed.mock.lastCall?.[0].config.args.template_name).toBe('fichas_tecnicas/ficha_tecnica.html');
});

it('elige la impresora y copias conservando el PDF conectado al sellador', async () => {
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: ['flows_print_pdf'], actions: ['flows_print_pdf'] });
  vi.spyOn(flowsApi, 'flowsPrintersList').mockResolvedValue({ printers: [{ name: 'Prueba', default: true }] });
  const changed = vi.fn();
  function Print() {
    const [node, setNode] = useState<FlowNode>({ id: 'print', kind: 'tool_call', name: 'Imprimir', position: { x: 0, y: 0 }, config: { method: 'flows_print_pdf', args: { pdf_path: '=nodes.sellar.json.saved_path', printer_name: '', copies: 1 } } });
    return <NodeConfigDrawer node={node} sources={[{ value: '=nodes.sellar.json.saved_path', label: 'PDF sellado' }]} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Print />);
  fireEvent.click(await screen.findByRole('button', { name: 'Impresora', exact: true }));
  fireEvent.click(await screen.findByText('Prueba (predeterminada)'));
  fireEvent.change(screen.getByLabelText('Copias'), { target: { value: '3' } });
  expect(changed.mock.lastCall?.[0].config.args).toEqual({ pdf_path: '=nodes.sellar.json.saved_path', printer_name: 'Prueba', copies: 3 });
  expect(screen.getByRole('button', { name: 'Dato para pdf_path' })).toHaveTextContent('PDF sellado');
  expect(screen.queryByRole('checkbox', { name: 'Reintentar si falla' })).not.toBeInTheDocument();
});

it('conserva el mapa de imágenes como datos conectados, sin selector de archivo individual', async () => {
  render(<NodeConfigDrawer node={{ id: 'pdf', kind: 'tool_call', name: 'Avisos', position: { x: 0, y: 0 }, config: { method: 'panel_aviso_corte_render_pdf', args: { image_paths: '=nodes.imagenes.json.image_paths' } } }} onChange={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText('Datos para la acción');
  expect(screen.queryByRole('button', { name: 'Elegir archivo', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Elegir archivo de salida', exact: true })).toBeVisible();
});

it('permite configurar la cantidad de sellos y omite reintentos de escritura', async () => {
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: ['sellador_apply'], actions: ['sellador_apply'] });
  const changed = vi.fn();
  render(<NodeConfigDrawer node={{ id: 'stamp', kind: 'tool_call', name: 'Sellar', position: { x: 0, y: 0 }, config: { method: 'sellador_apply', args: { stamp_count: 1 } } }} onChange={changed} onDelete={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText('Cantidad de sellos')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Valor de stamp_count'), { target: { value: '3' } });
  expect(changed.mock.lastCall?.[0].config.args.stamp_count).toBe(3);
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Reintentar si falla' })).not.toBeInTheDocument());
});

it('permite completar argumentos y guardar el identificador sin escribir JSON', async () => {
  const changed = vi.fn();
  function Action() {
    const [node, setNode] = useState<FlowNode>({ id: 'n1', kind: 'tool_call', name: 'Consulta', position: { x: 0, y: 0 }, config: { method: 'flows_get', args: { id: '' } } });
    return <NodeConfigDrawer node={node} onChange={(n) => { changed(n); setNode(n); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Action />);
  fireEvent.change(await screen.findByLabelText('Valor de id'), { target: { value: 'flujo-123' } });
  expect(changed.mock.lastCall?.[0].config.args).toEqual({ id: 'flujo-123' });
});

function Condition({ changed, value }: { changed: (node: FlowNode) => void; value?: unknown }) {
  const [node, setNode] = useState<FlowNode>({
    id: 'n1', kind: 'condition', name: 'Condición', position: { x: 0, y: 0 }, config: { value },
  });
  return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
}

it.each([
  ['true', true], ['false', false], ['10', 10], ['0', 0], ['-3.5', -3.5], ['null', null],
  ['[1,2]', [1, 2]], ['{"total":10}', { total: 10 }],
  ['"10"', '10'], ['"true"', 'true'], ['=run.trigger.umbral', '=run.trigger.umbral'],
  ['texto literal', 'texto literal'], ['', undefined],
] as const)('preserva el tipo del valor de comparación %s', async (raw, value) => {
  const changed = vi.fn();
  render(<Condition changed={changed} />);
  const field = screen.getByPlaceholderText('10 o =run.trigger.umbral');
  if (raw === '') fireEvent.change(field, { target: { value: 'previo' } });
  fireEvent.change(field, { target: { value: raw } });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(changed.mock.lastCall?.[0].config.value).toEqual(value);
});

it('permite completar una cadena numérica entre comillas sin convertirla al teclear', async () => {
  const changed = vi.fn();
  render(<Condition changed={changed} />);
  const field = screen.getByPlaceholderText('10 o =run.trigger.umbral');
  for (const raw of ['"', '"1', '"10', '"10"']) fireEvent.change(field, { target: { value: raw } });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(changed.mock.lastCall?.[0].config.value).toBe('10');
  expect(field).toHaveValue('"10"');
});

it.each([null, { total: 10 }, [1, 2]])('muestra %j existente como JSON editable', async (value) => {
  const changed = vi.fn();
  render(<Condition changed={changed} value={value} />);
  await waitFor(() => expect(flowsApi.flowsOrchestratableMethods).toHaveBeenCalled());
  expect(screen.getByPlaceholderText('10 o =run.trigger.umbral')).toHaveValue(JSON.stringify(value));
});

it('prepara el lote por OT y fecha, guarda el mapeo y permite sustituir las primeras seis fotos', async () => {
  const photos = Array.from({ length: 7 }, (_, i) => `subcarpeta/100_${i}.png`);
  const preview = vi.spyOn(flowsApi, 'flowsReadImages').mockResolvedValue({
    ready: true, reason: 'Lote completo', headers: ['Orden', 'Día', 'Dirección'],
    suggested_mappings: { OT: 'Orden', FECHA_TRABAJO: 'Día', DIRECCION: 'Dirección' },
    preview: [{ row_index: 0, ot: '100', date: '2026-10-04', data: { OT: '100' }, images: photos.slice(0, 6), candidates: photos, errors: [] }],
    pending: [], missing_mappings: [],
  });
  const changed = vi.fn();
  function Batch() {
    const [node, setNode] = useState<FlowNode>({ id: 'batch', kind: 'tool_call', name: 'Reportes', position: { x: 0, y: 0 }, config: {
      method: 'flows_read_images', args: { report_template: 'report.html', source_folder: 'C:\\fotos', output_folder: 'C:\\salida', spreadsheet_path: 'C:\\lote.xlsx', images_per_panel: 6, field_mappings: {} },
    } });
    return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Batch />);
  expect(screen.getByText('Excel común del lote')).toBeVisible();
  expect(screen.getByLabelText('images_per_panel')).toHaveAttribute('max', '6');
  expect(screen.queryByLabelText('expected_images')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar lote' }));
  fireEvent.click(await screen.findByText('Revisión de filas · 1'));
  await screen.findByText(/1 filas = 1 páginas/);
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ report_template: 'report.html', images_per_panel: 6 }));
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar mapeo sugerido' }));
  expect(changed.mock.lastCall?.[0].config.args.field_mappings).toEqual({ OT: 'Orden', FECHA_TRABAJO: 'Día', DIRECCION: 'Dirección' });
  expect(screen.getByRole('status')).toHaveTextContent('Hay cambios');
  fireEvent.click(screen.getByText(/Fila 1 · OT 100/));
  const seventh = screen.getByLabelText(`Fila 1: ${photos[6]}`);
  expect(seventh).toBeDisabled();
  fireEvent.click(screen.getByLabelText(`Fila 1: ${photos[0]}`));
  expect(seventh).toBeEnabled();
  fireEvent.click(seventh);
  expect(changed.mock.lastCall?.[0].config.args.photo_selections['0']).toEqual(photos.slice(1));
});

it('muestra las columnas ausentes y bloqueos de filas sin declarar el lote completo', async () => {
  vi.spyOn(flowsApi, 'flowsReadImages').mockResolvedValue({
    ready: false, reason: 'Revisa las columnas: DIRECCION', headers: ['OT', 'Fecha'],
    suggested_mappings: { OT: 'OT', FECHA_TRABAJO: 'Fecha', DIRECCION: '' }, missing_mappings: ['DIRECCION'],
    pending: [], preview: [{ row_index: 0, ot: '100', date: '2026-10-04', data: {}, images: [], candidates: [], errors: ['Esperando 6 fotos'] }],
  });
  render(<NodeConfigDrawer node={{ id: 'batch', kind: 'tool_call', name: 'Reportes', position: { x: 0, y: 0 }, config: {
    method: 'flows_read_images', args: { report_template: 'report.html', source_folder: 'C:\\fotos', output_folder: 'C:\\salida', spreadsheet_path: 'C:\\lote.xlsx', field_mappings: { DIRECCION: 'Antigua' } },
  } }} onChange={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar lote' }));
  await screen.findByText('Revisa el mapeo: DIRECCION');
  fireEvent.click(screen.getByText('Campos de la plantilla (1)'));
  expect(screen.getByText(/Exportación bloqueada/)).toBeVisible();
  expect(screen.queryByText('Todas las filas están completas.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Columna para DIRECCION' })).toHaveTextContent('Antigua (columna ausente)');
});


it('selecciona cualquier plantilla desde el lote y prepara certificados sin exigir fotos', async () => {
  const read = vi.spyOn(flowsApi, 'flowsReadImages').mockResolvedValue({
    ready: true, reason: 'Lote completo', template_name: 'certificados-sjl-blanco.html', image_limit: 0,
    headers: ['OT', 'Fecha', 'Nombre'], suggested_mappings: { OT: 'OT', FECHA_TRABAJO: 'Fecha', NOMBRE: 'Nombre' },
    preview: [{ row_index: 0, ot: '100', date: '2026-10-04', data: { NOMBRE: 'Cliente' }, images: [], candidates: [], errors: [] }],
  });
  const changed = vi.fn();
  function Batch() {
    const [node, setNode] = useState<FlowNode>({ id: 'batch', kind: 'tool_call', name: 'Reportes', position: { x: 0, y: 0 }, config: {
      method: 'flows_read_images', args: { report_template: 'report.html', source_folder: 'C:\\fotos', output_folder: 'C:\\salida', spreadsheet_path: 'C:\\lote.xlsx', images_per_panel: 6, field_mappings: { OT: 'OT', FECHA_TRABAJO: 'Fecha' } },
    } });
    return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Batch />);
  fireEvent.click(await screen.findByRole('button', { name: 'Plantilla del lote' }));
  fireEvent.click(screen.getByText('certificados-sjl-blanco.html'));
  expect(changed.mock.lastCall?.[0].config.args.report_template).toBe('certificados-sjl-blanco.html');
  expect(changed.mock.lastCall?.[0].config.args.field_mappings).toEqual({ OT: 'OT', FECHA_TRABAJO: 'Fecha' });
  fireEvent.click(screen.getByRole('button', { name: 'Revisar lote' }));
  await screen.findByText(/Esta plantilla no requiere fotos/);
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ report_template: 'certificados-sjl-blanco.html' }));
  expect(screen.queryByLabelText('images_per_panel')).not.toBeInTheDocument();
  expect(screen.getByText('Revisión de filas · 1')).toBeVisible();
  expect(screen.getByLabelText('Columna para NOMBRE')).not.toBeVisible();
  fireEvent.click(screen.getByText('Campos de la plantilla (1)'));
  expect(screen.getByRole('button', { name: 'Columna para NOMBRE' })).toBeVisible();
});
