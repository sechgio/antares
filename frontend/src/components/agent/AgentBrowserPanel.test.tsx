import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentBrowserState } from '../../api/agentApi';
import AgentBrowserPanel from './AgentBrowserPanel';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

const base: AgentBrowserState = {
  open: false, url: '', title: '', loading: false, can_go_back: false, can_go_forward: false, docked: true, user_control: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
});

it('coloca la página sobre su hueco, la retira al cerrarse y refleja lo que hace el agente', async () => {
  let notify: ((method: string, params: unknown) => void) | null = null;
  vi.spyOn(window.electronAPI, 'onNotify').mockImplementation((cb) => { notify = cb; return () => { notify = null; }; });
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(base);
  const { unmount } = render(<AgentBrowserPanel onClose={vi.fn()} />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('bounds', expect.objectContaining({ bounds: expect.objectContaining({ width: expect.any(Number) }) })));
  expect(screen.getByText('Aquí verás las páginas que abra el agente.')).toBeInTheDocument();
  const panel = screen.getByRole('complementary', { name: 'Navegador del agente' });
  expect(panel).toHaveClass('rounded-lg', 'border');
  for (const inset of ['mx-2.5', 'mb-2.5', 'rounded-xl', 'border']) {
    expect(screen.getByTestId('agent-browser-viewport')).not.toHaveClass(inset);
  }

  await act(async () => { notify?.('agent.browser', { ...base, open: true, url: 'https://es.wikipedia.org/wiki/Lima', can_go_back: true, reason: 'page' }); });
  expect(screen.getByLabelText('Dirección del navegador del agente')).toHaveValue('https://es.wikipedia.org/wiki/Lima');
  expect(screen.getByLabelText('Atrás')).toBeEnabled();
  expect(screen.queryByText('Aquí verás las páginas que abra el agente.')).not.toBeInTheDocument();

  unmount();
  expect(call).toHaveBeenLastCalledWith('bounds', { bounds: null });
});

it('abre direcciones desde la barra y permite tomar y devolver el control', async () => {
  const call = vi.spyOn(agentApi, 'agentBrowser').mockImplementation(async (action, extra) => (
    action === 'control' ? { ...base, open: true, user_control: !!extra?.user } : { ...base, open: true, url: extra?.url ?? '' }
  ));
  render(<AgentBrowserPanel onClose={vi.fn()} />);
  const input = screen.getByLabelText('Dirección del navegador del agente');
  fireEvent.change(input, { target: { value: 'example.com' } });
  await act(async () => { fireEvent.submit(input.closest('form')!); });
  expect(call).toHaveBeenCalledWith('open', { url: 'example.com' });

  fireEvent.click(screen.getByRole('button', { name: 'Más opciones del navegador' }));
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Tomar el control/ })); });
  expect(call).toHaveBeenCalledWith('control', { user: true });
  expect(screen.getByRole('status')).toHaveTextContent('Tienes el control');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Devolver' })); });
  expect(call).toHaveBeenCalledWith('control', { user: false });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('avisa de la espera humana y permite liberarla', async () => {
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue({
    ...base, open: true, url: 'https://example.com', busy_until: Date.now() + 4000, busy_reason: 'user_input',
  });
  const { unmount } = render(<AgentBrowserPanel onClose={vi.fn()} />);
  expect(await screen.findByText(/El agente espera porque usaste la página/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Permitir al agente' })); });
  expect(call).toHaveBeenCalledWith('allow', {});
  unmount();
});

const tab = (id: string, extra: Partial<NonNullable<AgentBrowserState['tabs']>[number]> = {}) => ({
  id, label: id === 'agent' ? 'Agente' : 'Nueva pestaña', open: false, url: '', title: '', loading: false,
  can_go_back: false, can_go_forward: false, user_control: false, busy_until: 0, busy_reason: '' as const, active: false, ...extra,
});

it('separa la pestaña fija del agente de las pestañas del usuario', async () => {
  const state: AgentBrowserState = {
    ...base,
    open: true,
    url: 'https://user.example',
    active_tab: 'user',
    tabs: [
      tab('agent', { open: true, url: 'https://agent.example', title: 'Docs' }),
      tab('user', { open: true, url: 'https://user.example', title: 'Mi página', active: true }),
    ],
  };
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(state);
  render(<AgentBrowserPanel onClose={vi.fn()} />);
  expect(await screen.findByRole('tablist', { name: 'Pestañas del navegador' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Mi página' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('button', { name: 'Cerrar Agente: Docs' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Más opciones del navegador' }));
  expect(screen.queryByRole('menuitem', { name: /Tomar el control/ })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Agente: Docs' })); });
  expect(call).toHaveBeenCalledWith('tab', { tab: 'agent' });
});

it('abre y cierra pestañas del usuario con un tope', async () => {
  const empty: AgentBrowserState = { ...base, active_tab: 'tab-1', tabs: [tab('agent'), tab('tab-1', { active: true })] };
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(empty);
  render(<AgentBrowserPanel onClose={vi.fn()} />);
  expect(await screen.findByText('Explorar la web')).toBeInTheDocument();
  expect(screen.getByText('Escribe una URL para abrir un sitio.')).toBeInTheDocument();
  expect(screen.getByLabelText('Dirección del navegador del agente')).toHaveAttribute('placeholder', 'Escribe una URL');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nueva pestaña' })); });
  expect(call).toHaveBeenCalledWith('new', {});
  expect(screen.getByLabelText('Dirección del navegador del agente')).toHaveFocus();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cerrar Nueva pestaña' })); });
  expect(call).toHaveBeenCalledWith('close', { tab: 'tab-1' });

  call.mockResolvedValue({ ...base, tabs: [tab('agent'), ...Array.from({ length: 8 }, (_, i) => tab(`tab-${i + 1}`))] });
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Agente' })); });
  expect(screen.getByRole('button', { name: 'Nueva pestaña' })).toBeDisabled();
});

it('desacopla la página mientras un menú la tapa y la vuelve a colocar al cerrarse', async () => {
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(base);
  const box = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  }) as DOMRect;
  render(<AgentBrowserPanel onClose={vi.fn()} />);
  vi.spyOn(screen.getByTestId('agent-browser-viewport'), 'getBoundingClientRect').mockReturnValue(box(600, 80, 400, 500));
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(box(520, 60, 200, 160));

  await act(async () => { document.body.appendChild(menu); });
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('bounds', { bounds: null }));
  await act(async () => { menu.remove(); });
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('bounds', { bounds: expect.objectContaining({ x: 600, y: 80 }) }));
});
