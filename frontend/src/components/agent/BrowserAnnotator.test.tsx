import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentBrowserElement, type AgentBrowserState } from '../../api/agentApi';
import AgentBrowserPanel from './AgentBrowserPanel';
import { annotationNotes, drawMark, type Mark } from './BrowserAnnotator';
import { fileSource, textPages } from './annotationSource';

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
  expect(onAnnotate).toHaveBeenCalledWith([expect.any(File)], page.url, []);
  expect((onAnnotate.mock.calls[0][0][0] as File).type).toBe('image/png');
  expect(screen.queryByRole('toolbar', { name: 'Herramientas de anotación' })).not.toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith('bounds', expect.objectContaining({ bounds: expect.objectContaining({ width: expect.any(Number) }) }));
});

const element: AgentBrowserElement = {
  tag: 'button', id: 'pay', classes: ['btn', 'primary'], selector: '#pay', role: '', label: '', text: 'Pagar ahora', href: '',
  box: { x: 0.25, y: 0.5, width: 0.25, height: 0.1 },
};

it('selecciona el elemento real bajo el puntero y lleva su contexto y las notas al chat', async () => {
  vi.spyOn(agentApi, 'agentBrowser').mockResolvedValue(page);
  vi.spyOn(agentApi, 'agentBrowserCapture').mockResolvedValue({ png_base64: 'iVBOR', width: 800, height: 600, url: page.url, title: page.title });
  const inspect = vi.spyOn(agentApi, 'agentBrowserInspect').mockResolvedValue(element);
  const ctx = { drawImage: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    setLineDash: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) { cb(new Blob(['png'], { type: 'image/png' })); });
  const onAnnotate = vi.fn();
  render(<AgentBrowserPanel onClose={vi.fn()} onAnnotate={onAnnotate} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Más opciones del navegador' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Más opciones del navegador' }));
  await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Anotar la página' })); });

  const canvas = await screen.findByTestId('annotation-canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  fireEvent.click(screen.getByLabelText('Seleccionar un elemento'));
  await act(async () => { fireEvent.pointerMove(canvas, { clientX: 140, clientY: 160 }); });
  expect(ctx.strokeRect).toHaveBeenCalledWith(200, 300, 200, 60);
  expect(ctx.setLineDash).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerLeave(canvas); });
  vi.mocked(ctx.strokeRect).mockClear();
  await act(async () => { fireEvent.pointerDown(canvas, { button: 0, clientX: 140, clientY: 160 }); });
  expect(inspect).toHaveBeenCalledWith(0.35, expect.closeTo(0.5333, 3));
  expect(ctx.strokeRect).toHaveBeenCalledWith(200, 300, 200, 60);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agregar al chat' })); });
  expect(onAnnotate).toHaveBeenCalledWith([expect.any(File)], page.url, ['[1] <button#pay.btn.primary> «Pagar ahora» — #pay']);
});

it('resume las notas escritas y los elementos por página', () => {
  const pick: Mark = { kind: 'pick', color: '#3b82f6', width: 2, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, n: 1, info: { ...element, href: 'https://example.com/pagar' } };
  const note: Mark = { kind: 'text', color: '#ef4444', width: 4, at: { x: 0, y: 0 }, text: 'Esto está mal' };
  expect(annotationNotes([[note], [pick]], true)).toEqual([
    'Nota (pág. 1): «Esto está mal»',
    '[1] (pág. 2) <button#pay.btn.primary> «Pagar ahora» — #pay → https://example.com/pagar',
  ]);
});

it('anota archivos de texto por páginas y rechaza formatos que no sabe dibujar', async () => {
  const pages = textPages(Array.from({ length: 130 }, (_, i) => `línea ${i + 1}`).join('\r\n'));
  expect(pages).toHaveLength(3);
  expect(pages[2][0]).toEqual({ n: '121', text: 'línea 121' });
  expect(textPages('x'.repeat(230))[0].map((line) => line.n)).toEqual(['1', '', '']);
  await expect(fileSource(new File(['x'], 'informe.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })))
    .rejects.toThrow(/no se puede anotar/);
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
