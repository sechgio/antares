import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskActivityFeed from '../components/TaskActivityFeed';

const mocks = vi.hoisted(() => ({ sendComment: vi.fn(), retry: vi.fn(), timeline: [] as unknown[] }));
vi.mock('../hooks/useTaskActivity', () => ({ useTaskActivity: () => ({
  comments: [], activity: [], timeline: mocks.timeline, loading: false, error: null,
  sending: false, sendError: null, sendComment: mocks.sendComment, retry: mocks.retry,
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.timeline = [];
});

describe('TaskActivityFeed', () => {
  it('prevents empty comments and sends trimmed text with Ctrl+Enter', async () => {
    mocks.sendComment.mockResolvedValue(undefined);
    render(<TaskActivityFeed tareaId="task-1" userId="user-1" members={[]} columns={[]} />);
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    const input = screen.getByPlaceholderText('Escribe un comentario…');
    fireEvent.change(input, { target: { value: '  Falta revisar.  ' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.sendComment).toHaveBeenCalledWith('Falta revisar.'));
    expect(input).toHaveValue('');
  });

  it('preserves the draft and shows a recoverable error when creation fails', async () => {
    mocks.sendComment.mockRejectedValue(new Error('No se pudo enviar'));
    render(<TaskActivityFeed tareaId="task-1" userId="user-1" members={[]} columns={[]} />);
    const input = screen.getByPlaceholderText('Escribe un comentario…');
    fireEvent.change(input, { target: { value: 'Texto pendiente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo enviar');
    expect(input).toHaveValue('Texto pendiente');
  });

  it('keeps a readable author label after the account is deleted', () => {
    mocks.timeline = [{
      kind: 'comment', id: 'comment-1', createdAt: '2026-09-15T10:00:00Z',
      comment: {
        id: 'comment-1', tarea_id: 'task-1', author_id: null, author_name: 'Persona temporal',
        body: 'Comentario persistente', created_at: '2026-09-15T10:00:00Z', updated_at: '2026-09-15T10:00:00Z',
      },
    }];
    render(<TaskActivityFeed tareaId="task-1" userId="user-1" members={[]} columns={[]} />);
    expect(screen.getByText('Persona temporal (usuario eliminado)')).toBeInTheDocument();
  });
});
