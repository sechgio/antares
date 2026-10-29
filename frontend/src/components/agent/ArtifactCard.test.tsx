import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentArtifact } from '../../api/agentApi';
import ArtifactCard, { ArtifactList } from './ArtifactCard';
import QuestionCard from './QuestionCard';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
const artifact: AgentArtifact = { id: 'a1', family: 'canvas', template_id: 'doc1', template_revision: 'r1',
  files: [{ name: 'Informe.pdf', sha256: 'hash', pages: 2, mime: 'application/pdf', size: 2048 }] };

beforeEach(() => { vi.restoreAllMocks(); addToast.mockClear(); document.documentElement.removeAttribute('data-theme'); });

it('muestra el recibo de la acción y su fuente de aprobación', () => {
  render(<ArtifactCard artifact={{ ...artifact,
    receipt: { channel: 'documents', approval_source: 'manual', status: 'succeeded' } }}
    sessionId="s1" onRefresh={vi.fn()} />);
  const receipt = screen.getByRole('group', { name: 'Recibo de la acción' });
  expect(receipt).toHaveTextContent('Documentos');
  expect(receipt).toHaveTextContent('Permitido por ti');
  expect(receipt).toHaveTextContent('No reversible');
});

it.each([['html', 'previewPanel', 'report.html'], ['formato', 'formatos', 'template-d']])('abre la plantilla %s que produjo el documento', (family, module, id) => {
  const onOpen = vi.fn();
  render(<ArtifactCard artifact={{ ...artifact, family, template_id: id }} sessionId="s1" onRefresh={vi.fn()} onOpenModule={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir módulo' }));
  expect(onOpen).toHaveBeenCalledWith(module, id);
});

it('revisa el hash mostrado antes de habilitar impresión y conserva la selección al abrir el módulo', async () => {
  const onOpen = vi.fn();
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockResolvedValueOnce({ png_base64: 'png', pages: 2, sha256: 'hash' })
    .mockResolvedValueOnce({ reviewed: true, sha256: 'hash' });
  render(<ArtifactCard artifact={artifact} sessionId="s1" onRefresh={vi.fn()} onOpenModule={onOpen} />);
  expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
  await screen.findByRole('img', { name: 'Página 1 de Informe.pdf' });
  fireEvent.click(screen.getByRole('button', { name: 'He revisado este PDF' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled());
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ session_id: 's1', artifact_id: 'a1', file_index: 0, sha256: 'hash', action: 'review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir módulo' }));
  expect(onOpen).toHaveBeenCalledWith('canvas', 'doc1');
});

it('un guardado fallido se reintenta con la misma identidad', async () => {
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue({ cancelled: true });
  render(<ArtifactCard artifact={artifact} sessionId="s1" onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(addToast).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[1][0].request_id).toBe(action.mock.calls[0][0].request_id);
});

it('muestra los resultados recientes y pliega los anteriores en lugar de apilarlos', () => {
  const items = ['1', '2', '3', '4'].map((n) => ({ ...artifact, id: `a${n}`,
    files: [{ ...artifact.files[0], name: `Informe-${n}.pdf`, sha256: n }] }));
  render(<ArtifactList artifacts={items} sessionId="s1" onRefresh={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'Documento Informe-1.pdf' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Documento Informe-4.pdf' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar 2 resultados anteriores' }));
  expect(screen.getAllByRole('region', { name: /Documento Informe/ })).toHaveLength(4);
});

it('las respuestas se envían a la conversación y pregunta originales', async () => {
  const answer = vi.spyOn(agentApi, 'agentQuestionAnswer').mockResolvedValue({ question: { id: 'q1', session_id: 's1', questions: [] } });
  render(<QuestionCard question={{ id: 'q1', session_id: 's1', questions: [{ id: 'template', prompt: 'Plantilla', options: ['A', 'B'] }] }} onAnswered={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Responder y continuar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Responder y continuar' }));
  await waitFor(() => expect(answer).toHaveBeenCalledWith('s1', 'q1', { template: 'B' }));
});

it('abre una página con su conversación y revisión sin acciones de PDF', async () => {
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockResolvedValue({ opened: true });
  const page: AgentArtifact = { ...artifact, kind: 'page', family: 'page', title: 'Trabajos de octubre',
    files: [{ name: 'Trabajos.html', mime: 'application/vnd.antares.page+json', size: 1200, sha256: 'revision' }] };
  render(<ArtifactCard artifact={page} sessionId="s1" onRefresh={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Página Trabajos de octubre' })).toHaveTextContent('Página interactiva');
  expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Vista previa' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir página Trabajos de octubre' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith({ session_id: 's1', artifact_id: 'a1',
    file_index: 0, action: 'open', sha256: 'revision', color_scheme: 'dark' }));
});

it('muestra una miniatura aislada y actualiza su revisión y apariencia', async () => {
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockImplementation(async (params) => ({
    html: `<h1>${params.sha256} ${params.color_scheme}</h1>`,
  }));
  const page: AgentArtifact = { ...artifact, kind: 'page', title: 'Informe' };
  const view = render(<ArtifactCard artifact={page} sessionId="s1" onRefresh={vi.fn()} />);
  const thumbnail = await screen.findByTitle('Miniatura de Informe');
  expect(thumbnail).toHaveAttribute('sandbox', '');
  expect(thumbnail).toHaveAttribute('inert');
  expect(thumbnail).toHaveAttribute('tabindex', '-1');
  expect(thumbnail).toHaveAttribute('srcdoc', '<h1>hash dark</h1>');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  document.documentElement.dataset.theme = 'light';
  await waitFor(() => expect(screen.getByTitle('Miniatura de Informe')).toHaveAttribute('srcdoc', '<h1>hash light</h1>'));
  view.rerender(<ArtifactCard artifact={{ ...page, files: [{ ...page.files[0], sha256: 'new' }] }} sessionId="s1" onRefresh={vi.fn()} />);
  await waitFor(() => expect(screen.getByTitle('Miniatura de Informe')).toHaveAttribute('srcdoc', '<h1>new light</h1>'));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir página Informe' }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith({ session_id: 's1', artifact_id: 'a1',
    file_index: 0, action: 'open', sha256: 'new', color_scheme: 'light' }));
});

it('permite reintentar la apertura de una página fallida', async () => {
  vi.spyOn(agentApi, 'agentArtifactAction').mockRejectedValue(new Error('La página cambió'));
  render(<ArtifactCard artifact={{ ...artifact, kind: 'page', title: 'Informe' }} sessionId="s1" onRefresh={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir página Informe' })).toBeEnabled());
  expect(addToast).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir página Informe' }));
  await waitFor(() => expect(addToast).toHaveBeenCalledWith({ message: 'La página cambió', type: 'error' }));
  expect(screen.getByRole('button', { name: 'Abrir página Informe' })).toBeEnabled();
});
