import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AgentMessage, AgentSession } from '../../api/agentApi';
import ConversationMenu, { conversationText } from './ConversationMenu';
import { groupSessions } from './AgentView';

const session: AgentSession = { id: 's1', title: 'Cierre', provider: 'p', model: 'm', created_at: 1, updated_at: 1, last_error: null };
const messages: AgentMessage[] = [
  { role: 'user', content: 'Genera el informe', ts: 1 },
  { role: 'tool_result', content: '{"ok":true}', ts: 2 },
  { role: 'assistant', content: 'Listo', ts: 3 },
];

it('copia la conversación como texto legible sin resultados internos de herramientas', () => {
  expect(conversationText('Cierre', messages)).toBe('# Cierre\n\nTú:\nGenera el informe\n\nAgente:\nListo');
});

it('renombra desde el menú y elimina sin pasos extra', async () => {
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn();
  render(<ConversationMenu session={session} messages={messages} onRename={onRename} onDelete={onDelete} onCopied={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Opciones de la conversación'));
  fireEvent.click(screen.getByRole('menuitem', { name: /Renombrar/ }));
  fireEvent.change(screen.getByLabelText('Nuevo nombre de la conversación'), { target: { value: '  Marzo  ' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(onRename).toHaveBeenCalledWith('Marzo');
  fireEvent.click(screen.getByLabelText('Opciones de la conversación'));
  fireEvent.click(screen.getByRole('menuitem', { name: /Eliminar/ }));
  expect(onDelete).toHaveBeenCalledOnce();
});

it('agrupa las conversaciones por su última actividad', () => {
  const now = new Date(2026, 9, 13, 12).getTime();
  const at = (days: number) => ({ ...session, id: `d${days}`, updated_at: now - days * 86_400_000 });
  const groups = groupSessions([at(0), at(1), at(3), at(30)], now);
  expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
    ['Hoy', ['d0']], ['Ayer', ['d1']], ['Últimos 7 días', ['d3']], ['Anteriores', ['d30']],
  ]);
});
