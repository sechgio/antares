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
  expect(panel.parentElement).toHaveClass('-ml-3', '-mr-2.5', '-my-2.5');
  expect(panel).not.toHaveClass('rounded-[24px]');
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

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Tomar el control/ })); });
  expect(call).toHaveBeenCalledWith('control', { user: true });
  expect(screen.getByRole('status')).toHaveTextContent('Tienes el control');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Devolver/ })); });
  expect(call).toHaveBeenCalledWith('control', { user: false });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
