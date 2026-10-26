import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApprovalCard, MessageRow } from './AgentTimeline';

afterEach(cleanup);

it('ofrece reglas rápidas del canal desde la aprobación', () => {
  const onRule = vi.fn();
  const approval = {
    id: 'a1', session_id: 's', call_id: 'c', method: 'gdrive_upload', params: { draft: 'resumen.pdf' },
    status: 'pending' as const, created_at: 1, decided_at: null, channel: 'cloud' as const,
  };
  const { rerender } = render(<ApprovalCard busy={false} onDecide={vi.fn()} onRule={onRule} approval={approval} />);
  expect(screen.queryByText('Solo esta acción')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Permitir siempre este canal en esta conversación: Nube y conexiones' }));
  expect(onRule).toHaveBeenCalledWith('cloud', 'allow');
  fireEvent.click(screen.getByRole('button', { name: 'Bloquear este canal en esta conversación' }));
  expect(onRule).toHaveBeenCalledWith('cloud', 'deny');
  rerender(<ApprovalCard busy onDecide={vi.fn()} onRule={onRule} approval={approval} />);
  expect(screen.getByRole('button', { name: 'Permitir siempre este canal en esta conversación: Nube y conexiones' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Bloquear este canal en esta conversación' })).toBeDisabled();
});

it.each(['terminal', 'other'] as const)('no ofrece permitir siempre en el canal %s', (channel) => {
  render(<ApprovalCard busy={false} onDecide={vi.fn()} onRule={vi.fn()} approval={{
    id: 'a1', session_id: 's', call_id: 'c', method: 'shell_run', params: { command: 'npm test' },
    status: 'pending', created_at: 1, decided_at: null, channel,
  }} />);
  expect(screen.queryByRole('button', { name: /Permitir siempre/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bloquear este canal en esta conversación' })).toBeInTheDocument();
});

it('muestra el recibo del canal, la regla aplicada y deshace con el id durable', async () => {
  const onUndo = vi.fn().mockResolvedValue(undefined);
  render(<MessageRow onUndo={onUndo} msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'call-1', dispatch_id: 'call-1@task:t1', name: 'fs_write', params: {}, gated: true, status: 'done',
    result: '{"saved_path":"a.txt"}', channel: 'files', approval_source: 'rule', undo: { available: true, kind: 'delete' },
  }] }} />);
  expect(screen.getByText('Archivos')).toBeVisible();
  expect(screen.getByText('Permitido por regla')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Deshacer/ })); });
  expect(onUndo).toHaveBeenCalledWith('call-1@task:t1');
});

it('declara no reversible un efecto sin copia previa', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'call-2', name: 'shell_run', params: { command: 'echo hola' }, gated: true, status: 'done',
    result: '{}', channel: 'terminal', approval_source: 'manual',
  }] }} />);
  expect(screen.getByText('Terminal')).toBeVisible();
  expect(screen.getByText('Permitido por ti')).toBeVisible();
  expect(screen.getByText(/No reversible/)).toBeVisible();
});

it('marca una escritura recuperada tras reiniciar y conserva su Undo', () => {
  render(<MessageRow onUndo={vi.fn().mockResolvedValue(undefined)} msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'rec', dispatch_id: 'rec@task:t', name: 'fs_write', params: {}, gated: true, status: 'done',
    result: '{"recovered":true}', channel: 'files', approval_source: 'manual', recovered: true,
    undo: { available: true, kind: 'restore' },
  }] }} />);
  expect(screen.getByText('Recuperado')).toBeVisible();
  expect(screen.getByRole('button', { name: /Deshacer/ })).toBeVisible();
});

it('no muestra recibo en lecturas sin efecto', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'read', name: 'fs_read', params: {}, gated: false, status: 'done', result: '{}', channel: 'files',
  }] }} />);
  expect(screen.queryByRole('group', { name: 'Recibo de la acción' })).not.toBeInTheDocument();
});

it('no duplica el recibo mientras la aprobación sigue pendiente', () => {
  render(<MessageRow msg={{ role: 'assistant', content: '', ts: 1, tool_calls: [{
    id: 'call-3', name: 'fs_write', params: {}, gated: true, status: 'pending', channel: 'files',
  }] }} />);
  expect(screen.queryByRole('group', { name: 'Recibo de la acción' })).not.toBeInTheDocument();
});
