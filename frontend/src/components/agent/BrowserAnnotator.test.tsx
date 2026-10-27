import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentBrowserState } from '../../api/agentApi';
import AgentBrowserPanel from './AgentBrowserPanel';
import { drawMark } from './BrowserAnnotator';

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const page: AgentBrowserState = {
  open: true, url: 'https://example.com', title: 'Example', loading: false, can_go_back: false, can_go_forward: false, docked: true, user_control: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
});

it('congela la página, retira la vista nativa mientras se anota y envía la captura al chat', async () => {
  const call = vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(page);
  vi.spyOn(agentApi, 'agentBrowserCapture').mockResolvedValue({ png_base64: 'iVBOR', width: 800, height: 600, url: page.url, title: page.title });
  const ctx = { drawImage: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) { cb(new Blob(['png'], { type: 'image/png' })); });
  const onAnnotate = vi.fn();
  render(<AgentBrowserPanel onClose={vi.fn()} onAnnotate={onAnnotate} />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('state'));
  fireEvent.click(screen.getByRole('button', { name: 'Más opciones del navegador' }));
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Anotar la página' })).toBeEnabled());

  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Anotar la página' })); });
  expect(screen.getByRole('toolbar', { name: 'Herramientas de anotación' })).toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith('bounds', { bounds: null });

  fireEvent.click(screen.getByLabelText('Formas'));
  for (const label of ['Línea', 'Flecha', 'Rectángulo', 'Elipse', 'Paso']) expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Flecha' }));
  expect(screen.getByLabelText('Flecha')).toHaveAttribute('aria-pressed', 'true');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agregar al chat' })); });
  expect(onAnnotate).toHaveBeenCalledWith(expect.any(File), page.url);
  expect((onAnnotate.mock.calls[0][0] as File).type).toBe('image/png');
  expect(screen.queryByRole('toolbar', { name: 'Herramientas de anotación' })).not.toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith('bounds', expect.objectContaining({ bounds: expect.objectContaining({ width: expect.any(Number) }) }));
});

it('dibuja cada forma con su color y numera los pasos', () => {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(),
    strokeRect: vi.fn(), ellipse: vi.fn(), arc: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  drawMark(ctx, { kind: 'rect', color: '#ef4444', width: 4, from: { x: 10, y: 10 }, to: { x: 50, y: 30 } }, 1);
  expect(ctx.strokeRect).toHaveBeenCalledWith(10, 10, 40, 20);
  expect(ctx.strokeStyle).toBe('#ef4444');
  drawMark(ctx, { kind: 'step', color: '#3b82f6', width: 4, at: { x: 5, y: 5 }, n: 3 }, 1);
  expect(ctx.fillText).toHaveBeenCalledWith('3', 5, 6);
  drawMark(ctx, { kind: 'arrow', color: '#000', width: 2, from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }, 1);
  expect(ctx.fill).toHaveBeenCalled();
});
