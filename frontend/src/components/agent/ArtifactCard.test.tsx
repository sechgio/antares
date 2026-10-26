import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentArtifact } from '../../api/agentApi';
import ArtifactCard, { ArtifactList } from './ArtifactCard';
import QuestionCard from './QuestionCard';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
const artifact: AgentArtifact = { id: 'a1', family: 'canvas', template_id: 'doc1', template_revision: 'r1',
  files: [{ name: 'Informe.pdf', sha256: 'hash', pages: 2, mime: 'application/pdf', size: 2048 }] };

beforeEach(() => { vi.restoreAllMocks(); addToast.mockClear(); });

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
