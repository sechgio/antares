import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { flowsApi, type ReportBatchPreview } from '../../api/flowsApi';
import { toolsApi } from '../../api/toolsApi';
import { systemApi } from '../../api/systemApi';
import type { FlowNode } from './types';
import FlowGuide from './FlowGuide';
import FlowList from './FlowList';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../sellador/PdfPagePreview', () => ({ default: ({ pageNum }: { pageNum: number }) => <div>PDF real · página {pageNum}</div> }));

const initial: FlowNode = { id: 'entradas', name: 'Preparar', kind: 'tool_call', position: { x: 0, y: 0 }, config: {
  method: 'flows_read_images', _file_grants: { signature: 'saved' }, args: { guided_pdf: true, template_kind: 'html', template_id: 'report.html', output_folder: 'C:\\salida', field_values: { OT: '42' } },
} };
const complete: ReportBatchPreview = { ready: true, reason: 'Lote completo', headers: ['OT'], image_limit: 2,
  suggested_mappings: { OT: 'OT' }, field_labels: { OT: 'Orden de trabajo' }, output_names: ['Informe-versión.pdf'],
  preview: [{ row_index: 0, record_key: 'record-42', ot: '42', date: '', data: { OT: '42' }, images: ['a.png', 'b.png'], candidates: ['a.png', 'b.png'], errors: [] }],
};

function Harness({ node = initial }: { node?: FlowNode }) {
  const [current, setCurrent] = useState(node);
  const [trigger, setTrigger] = useState<FlowNode>({ id: 'trigger', name: 'Inicio', kind: 'trigger', position: { x: 0, y: 0 }, config: { trigger_kind: 'manual' } });
  return <><FlowGuide node={current} trigger={trigger} onChange={(next) => next.id === 'trigger' ? setTrigger(next) : setCurrent(next)} /><output data-testid="config">{JSON.stringify(current.config.args)}</output><output data-testid="trigger">{JSON.stringify(trigger.config)}</output></>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  vi.spyOn(toolsApi, 'templatesList').mockResolvedValue({ templates: [{ id: 'report', name: 'report.html', filename: 'report.html' }] });
  vi.spyOn(flowsApi, 'flowsReadImages').mockResolvedValue({ ...complete });
  vi.spyOn(flowsApi, 'flowsPdfPreview').mockResolvedValue({ ...complete, pdf_base64: 'pdf', preview_pages: 2 });
});

it('conserva las correcciones por registro y el orden de las fotos en los argumentos del nodo', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '3. Personalizar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revisar datos y fotos' }));
  fireEvent.change(await screen.findByLabelText('Registro 1: OT'), { target: { value: '43' } });
  fireEvent.click(screen.getByLabelText('Bajar foto a.png'));
  const args = JSON.parse(screen.getByTestId('config').textContent!);
  expect(args.row_values).toEqual({ 'record-42': { OT: '43' } });
  expect(args.photo_selections).toEqual({ 'record-42': ['b.png', 'a.png'] });
  expect(flowsApi.flowsReadImages).toHaveBeenCalledWith(expect.objectContaining({ _flow_file_grants: { signature: 'saved' } }));
});

it('muestra el PDF y permite recorrer sus páginas sin exportar la entrega', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '5. Vista previa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revisar PDF' }));
  expect(await screen.findByText('PDF real · página 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
  expect(screen.getByText('PDF real · página 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '4. Salida' }));
  fireEvent.change(screen.getByLabelText('Nombre del PDF'), { target: { value: 'Otro_{OT}' } });
  fireEvent.click(screen.getByRole('button', { name: '5. Vista previa' }));
  expect(screen.queryByText('PDF real · página 2')).not.toBeInTheDocument();
  expect(screen.getByText('Revisa el PDF para comprobar la configuración actual.')).toBeInTheDocument();
});

it('descarta una respuesta de vista previa si la configuración cambió mientras se preparaba', async () => {
  let finish!: (value: ReportBatchPreview) => void;
  vi.mocked(flowsApi.flowsPdfPreview).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '5. Vista previa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revisar PDF' }));
  fireEvent.click(screen.getByRole('button', { name: '4. Salida' }));
  fireEvent.change(screen.getByLabelText('Nombre del PDF'), { target: { value: 'Actual' } });
  finish({ ...complete, pdf_base64: 'old', preview_pages: 1 });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Preparando…' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '5. Vista previa' }));
  expect(screen.queryByText('PDF real · página 1')).not.toBeInTheDocument();
});

it('elige un Excel sin restaurar el origen anterior y configura automatización solo con Antares abierto', async () => {
  vi.spyOn(systemApi, 'dialogFiles').mockResolvedValue({ paths: ['C:\\datos.xlsx'], file_tokens: ['token'] });
  render(<Harness node={{ ...initial, config: { ...initial.config, args: { ...initial.config.args as object, records_source: 'technical_reports' } } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Elegir Excel' }));
  await waitFor(() => expect(screen.getByTestId('config')).toHaveTextContent('datos.xlsx'));
  expect(JSON.parse(screen.getByTestId('config').textContent!).records_source).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '4. Salida' }));
  fireEvent.click(screen.getByLabelText('Revisar carpetas automáticamente con Antares abierto'));
  expect(JSON.parse(screen.getByTestId('trigger').textContent!)).toEqual({ trigger_kind: 'schedule', runtime: 'app_open', interval_minutes: 1 });
});

it('crea un flujo guiado conectado al exportador desde el listado', async () => {
  vi.spyOn(flowsApi, 'flowsList').mockResolvedValue({ flows: [] });
  const create = vi.spyOn(flowsApi, 'flowsCreate').mockImplementation(async (params) => ({ flow: {
    id: 'nuevo', name: params.name ?? '', description: '', enabled: false, created_at: '', updated_at: '',
    last_run_at: null, last_run_status: null, graph: params.graph!,
  } }));
  const open = vi.fn();
  render(<FlowList onOpen={open} onRun={vi.fn()} onShowRuns={vi.fn()} refreshKey={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Crear PDF con guía' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('nuevo'));
  const graph = create.mock.calls[0][0].graph!;
  expect(graph.nodes.find((node) => node.id === 'entradas')?.config.args).toMatchObject({ guided_pdf: true });
  expect(graph.nodes.find((node) => node.id === 'generar')?.config.args).toBe('=nodes.entradas.json.pdf_args');
  expect(graph.edges).toHaveLength(2);
});
