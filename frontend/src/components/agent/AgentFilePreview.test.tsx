import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentFilePreview as FilePreviewData } from '../../api/agentApi';
import AgentFilePreview from './AgentFilePreview';

afterEach(() => vi.restoreAllMocks());
const target = { kind: 'resource', resource: 'informe.pdf' } as const;

it('carga páginas PDF, ajusta el zoom y cierra con Escape', async () => {
  const preview = vi.spyOn(agentApi, 'agentFilePreview').mockImplementation(async (_session, _target, page = 0) => ({
    kind: 'pdf', name: 'informe.pdf', size: 1024, page, pages: 2, png_base64: 'cG5n',
  }));
  const close = vi.fn();
  render(<AgentFilePreview sessionId="s1" target={target} onClose={close} />);
  expect(await screen.findByAltText('Página 1 de informe.pdf')).toBeInTheDocument();
  expect(screen.getByLabelText('Página anterior')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Acercar'));
  expect(screen.getByAltText('Página 1 de informe.pdf')).toHaveStyle({ width: '125%' });
  fireEvent.click(screen.getByLabelText('Página siguiente'));
  expect(await screen.findByAltText('Página 2 de informe.pdf')).toBeInTheDocument();
  expect(preview).toHaveBeenLastCalledWith('s1', target, 1, 0);
  expect(screen.getByLabelText('Página siguiente')).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Cerrar vista previa'), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('permite cambiar de hoja y reinicia la página de Excel', async () => {
  const preview = vi.spyOn(agentApi, 'agentFilePreview').mockImplementation(async (_session, _target, page = 0, sheet = 0) => ({
    kind: 'spreadsheet', name: 'datos.xlsx', size: 500, sheets: ['Resumen', 'Detalle'], sheet, page,
    pages: 2, total_rows: 70, total_columns: 2, rows: [[sheet ? 'Detalle A' : 'Resumen A', '42']], row_start: page * 50 + 1, truncated: false,
  }));
  render(<AgentFilePreview sessionId="s1" target={target} onClose={vi.fn()} />);
  expect(await screen.findByText('Resumen A')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Página siguiente'));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith('s1', target, 1, 0));
  await screen.findByLabelText('Hoja de cálculo');
  fireEvent.click(screen.getByLabelText('Hoja de cálculo'));
  fireEvent.click(await screen.findByRole('option', { name: 'Detalle' }));
  expect(await screen.findByText('Detalle A')).toBeInTheDocument();
  expect(preview).toHaveBeenLastCalledWith('s1', target, 0, 1);
});

it('muestra Word estructurado y no interpreta contenido como HTML', async () => {
  vi.spyOn(agentApi, 'agentFilePreview').mockResolvedValue({ kind: 'document', name: 'acta.docx', size: 500, truncated: true,
    blocks: [{ kind: 'paragraph', text: 'Acta', style: 'h1' }, { kind: 'table', rows: [['<script>mal()</script>', 'Listo']] }] });
  const { container } = render(<AgentFilePreview sessionId="s1" target={target} onClose={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Acta' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '<script>mal()</script>' })).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('Se muestra una parte del contenido por su tamaño.')).toBeInTheDocument();
});

it('permite reintentar y descarta respuestas después de desmontar', async () => {
  let finish: (data: FilePreviewData) => void = () => {};
  const preview = vi.spyOn(agentApi, 'agentFilePreview').mockRejectedValueOnce(new Error('No autorizado'))
    .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { unmount } = render(<AgentFilePreview sessionId="s1" target={target} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No autorizado');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(preview).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { finish({ kind: 'text', name: 't.txt', size: 1, text: 'Respuesta tardía', truncated: false }); });
  expect(screen.queryByText('Respuesta tardía')).toBeNull();
});
