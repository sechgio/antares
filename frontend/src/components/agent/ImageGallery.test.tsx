import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentImageArtifact } from '../../api/agentApi';
import ArtifactCard, { ArtifactList } from './ArtifactCard';
import { AssistantTurn, groupTurns, placeArtifacts } from './AgentTimeline';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
const artifact: AgentImageArtifact = { id: 'images-1', kind: 'image', family: 'image', files: [
  { name: 'metrado.png', title: 'Metrado por día', sha256: 'one', mime: 'image/png', size: 1000, width: 900, height: 600 },
  { name: 'trabajos.png', title: 'Trabajos por día', sha256: 'two', mime: 'image/png', size: 1000, width: 900, height: 600 },
  { name: 'cuadrillas.png', title: 'Cuadrillas MB', sha256: 'three', mime: 'image/png', size: 1000, width: 900, height: 600 },
] };

beforeEach(() => { vi.restoreAllMocks(); addToast.mockClear(); });

it('carga los previews por identidad y permite ampliar, navegar, ajustar y cerrar con Escape', async () => {
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockImplementation(async (params) => ({ png_base64: 'png', sha256: params.sha256 }));
  render(<ArtifactCard artifact={artifact} sessionId="s1" onRefresh={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
  expect(action).toHaveBeenCalledTimes(3);
  expect(action).toHaveBeenCalledWith(expect.objectContaining({ session_id: 's1', artifact_id: 'images-1', file_index: 0, sha256: 'one', full_size: false }));
  expect(screen.queryByText('Pendiente de revisión')).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Ampliar Metrado por día' });
  trigger.focus();
  fireEvent.click(trigger);
  const viewer = screen.getByRole('dialog', { name: 'Metrado por día' });
  expect(viewer).toHaveAttribute('aria-modal', 'true');
  await within(viewer).findByRole('img', { name: 'Metrado por día' });
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ file_index: 0, full_size: true, sha256: 'one' }));
  fireEvent.click(within(viewer).getByRole('button', { name: 'Ampliar imagen' }));
  expect(within(viewer).getByRole('button', { name: 'Ajustar imagen' })).toHaveAttribute('aria-pressed', 'true');
  expect(action).toHaveBeenCalledTimes(4);
  fireEvent.keyDown(within(viewer).getByRole('button', { name: 'Imagen siguiente' }), { key: 'ArrowRight' });
  await screen.findByRole('dialog', { name: 'Trabajos por día' });
  expect(within(viewer).getByRole('button', { name: 'Ampliar imagen' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('un cambio de conversación no reutiliza un preview pendiente', async () => {
  let settle: ((result: { png_base64: string; sha256: string }) => void) | undefined;
  vi.spyOn(agentApi, 'agentArtifactAction').mockImplementation((params) => params.session_id === 's1'
    ? new Promise((resolve) => { settle = resolve; })
    : Promise.resolve({ png_base64: 'new-image', sha256: params.sha256 }));
  const single: AgentImageArtifact = { ...artifact, files: [artifact.files[0]] };
  const view = render(<ArtifactCard artifact={single} sessionId="s1" onRefresh={vi.fn()} />);
  view.rerender(<ArtifactCard artifact={single} sessionId="s2" onRefresh={vi.fn()} />);
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,new-image');
  settle?.({ png_base64: 'old-image', sha256: 'one' });
  await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,new-image'));
});

it('no muestra datos con un hash incorrecto y permite reintentar un preview fallido', async () => {
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockResolvedValue({ png_base64: 'bad', sha256: 'other' });
  render(<ArtifactCard artifact={{ ...artifact, files: [artifact.files[0]] }} sessionId="s1" onRefresh={vi.fn()} />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar Metrado por día' }));
  const viewer = screen.getByRole('dialog');
  await within(viewer).findByRole('button', { name: 'Reintentar' });
  action.mockResolvedValue({ png_base64: 'good', sha256: 'one' });
  fireEvent.click(within(viewer).getByRole('button', { name: 'Reintentar' }));
  expect(await within(viewer).findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,good');
});

it('conserva la identidad al reintentar la descarga y actualiza las aprobaciones del chat', async () => {
  let saves = 0;
  const action = vi.spyOn(agentApi, 'agentArtifactAction').mockImplementation(async (params) => {
    if (params.action === 'save') {
      if (++saves === 1) throw new Error('Sin conexión');
      return { cancelled: true };
    }
    return { png_base64: 'png', sha256: params.sha256 };
  });
  const refresh = vi.fn();
  render(<ArtifactCard artifact={artifact} sessionId="s1" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Descargar Trabajos por día' }));
  await waitFor(() => expect(addToast).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar Trabajos por día' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Descargar Trabajos por día' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const requests = action.mock.calls.map(([params]) => params).filter((params) => params.action === 'save');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ session_id: 's1', artifact_id: 'images-1', file_index: 1, sha256: 'two', request_id: requests[0].request_id });
});

it('el resultado de images_show aparece dentro de la respuesta del agente que lo produjo, también al reabrir', async () => {
  vi.spyOn(agentApi, 'agentArtifactAction').mockImplementation(async (params) => ({ png_base64: 'png', sha256: params.sha256 }));
  const turns = groupTurns([
    { role: 'user', content: 'Grafica los datos', ts: 1 },
    { role: 'assistant', content: '', ts: 2, tool_calls: [{ id: 'show', name: 'images_show', status: 'done', gated: false,
      params: { images: [{ path: 'metrado.png' }] }, result: JSON.stringify({ artifact }) }] },
    { role: 'assistant', content: 'Aquí están los gráficos.', ts: 3 },
    { role: 'user', content: 'Gracias', ts: 4 },
    { role: 'assistant', content: 'Listo.', ts: 5 },
  ]);
  const producer = turns[1];
  if (producer.role !== 'assistant') throw new Error('Falta el turno del agente');
  for (let reopen = 0; reopen < 2; reopen++) {
    const placed = placeArtifacts(turns, [structuredClone(artifact)]);
    expect(placed.get(producer.key)?.map((item) => item.id)).toEqual(['images-1']);
    expect(placed.has(turns[3].key)).toBe(false);
    const view = render(<AssistantTurn messages={producer.messages}
      results={<ArtifactList artifacts={placed.get(producer.key) ?? []} sessionId="s1" onRefresh={vi.fn()} />} />);
    expect(screen.getByText('Aquí están los gráficos.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Imágenes generadas' })).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    view.unmount();
  }
});
