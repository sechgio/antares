import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentApproval, type AgentSession } from '../../api/agentApi';
import AgentAuditPanel from './AgentAuditPanel';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

const sessions: AgentSession[] = [
  { id: 's1', title: 'Primera', provider: 'local', model: 'm', created_at: 1, updated_at: 1, last_error: null },
  { id: 's2', title: 'Segunda', provider: 'local', model: 'm', created_at: 1, updated_at: 1, last_error: null },
];

const approved: AgentApproval = {
  id: 'a1', session_id: 's1', call_id: 'c1', method: 'fs_read', params: { path: 'C:/datos.csv' },
  status: 'approved', created_at: 1000, decided_at: 2000, consumed_by: 'op-1',
  resources: [{ path: 'C:/datos.csv' }], dispatch: { status: 'succeeded', finished_at: 3000 },
};
const denied: AgentApproval = {
  id: 'a2', session_id: 's2', call_id: 'c2', method: 'db_export', params: { path: 'C:/fuera.xlsx' },
  status: 'denied', created_at: 500, decided_at: 600, resources: [{ path: 'C:/fuera.xlsx' }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  confirm.mockReset();
  vi.spyOn(agentApi, 'agentApprovalsHistory').mockResolvedValue({ approvals: [approved, denied] });
  vi.spyOn(agentApi, 'agentGrantsList').mockResolvedValue({
    grants: [{ path: 'C:/datos.csv', mode: 'read' }, { path: 'C:/otro.csv', mode: 'read' }],
  });
  vi.spyOn(agentApi, 'agentGrantsRevoke').mockResolvedValue({ revoked: 1 });
});

async function open(sessionId?: string) {
  render(<AgentAuditPanel sessions={sessions} sessionId={sessionId} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Leer un archivo')).toBeInTheDocument());
}

it('filtra decisiones por estado y herramienta y muestra el detalle auditado', async () => {
  await open();
  expect(screen.getByText('Exportar el catálogo')).toBeInTheDocument();
  expect(screen.getByText('Aprobada')).toBeInTheDocument();
  expect(screen.getByText('Rechazada')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Rechazadas' }));
  expect(screen.queryByText('Leer un archivo')).not.toBeInTheDocument();
  expect(screen.getByText('Exportar el catálogo')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
  fireEvent.change(screen.getByLabelText('Filtrar por herramienta'), { target: { value: 'leer un' } });
  expect(screen.getByText('Leer un archivo')).toBeInTheDocument();
  expect(screen.queryByText('Exportar el catálogo')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Leer un archivo' }));
  expect(screen.getByText('Recursos')).toBeInTheDocument();
  expect(screen.getByText(/op-1/)).toBeInTheDocument();
  expect(screen.getByText(/"path": "C:\/datos.csv"/)).toBeInTheDocument();
});

it('exporta el historial visible a JSON y CSV', async () => {
  const createObjectURL = vi.fn(() => 'blob:historial');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await open();

  fireEvent.click(screen.getByRole('button', { name: /Exportar JSON/ }));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:historial');

  fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
  expect(createObjectURL).toHaveBeenCalledTimes(2);
});

it('revoca un acceso concreto o todos los de la conversación tras confirmar', async () => {
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  await open('s1');
  await waitFor(() => expect(screen.getByText('C:/datos.csv')).toBeInTheDocument());
  const revoke = vi.mocked(agentApi.agentGrantsRevoke);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revocar acceso a C:/datos.csv' })); });
  expect(revoke).not.toHaveBeenCalled();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revocar acceso a C:/datos.csv' })); });
  expect(revoke).toHaveBeenLastCalledWith('s1', 'C:/datos.csv');
  expect(screen.queryByText('C:/datos.csv')).not.toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revocar todos los accesos' })); });
  expect(revoke).toHaveBeenLastCalledWith('s1', undefined);
  expect(screen.queryByText('C:/otro.csv')).not.toBeInTheDocument();
});
