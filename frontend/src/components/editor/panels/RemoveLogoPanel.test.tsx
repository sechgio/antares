import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoveLogoPanel } from './RemoveLogoPanel';
import type { DelogoRect } from '../types';

function rect(overrides: Partial<DelogoRect> = {}): DelogoRect {
  return { id: 'mask-1', x: 0.1, y: 0.1, width: 0.2, height: 0.2, ...overrides };
}

describe('RemoveLogoPanel', () => {
  it('pide selección de clip cuando no hay ninguno', () => {
    render(<RemoveLogoPanel clipId={null} rects={[]} onApply={vi.fn()} />);
    expect(screen.getByText(/Selecciona un clip de video/)).toBeInTheDocument();
  });

  it('muestra el overlay con las máscaras existentes', () => {
    render(<RemoveLogoPanel clipId="c1" rects={[rect()]} onApply={vi.fn()} />);
    expect(screen.getByTestId('delogo-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('delogo-rect-mask-1')).toBeInTheDocument();
  });

  it('aplica las máscaras sin cambios', () => {
    const onApply = vi.fn();
    render(<RemoveLogoPanel clipId="c1" rects={[rect()]} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith([rect()]);
  });

  it('cancelar restaura la lista previa', () => {
    const onApply = vi.fn();
    render(<RemoveLogoPanel clipId="c1" rects={[rect()]} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Borrar máscara' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith([rect()]);
  });

  it('restablecer elimina todas las máscaras', () => {
    const onApply = vi.fn();
    render(<RemoveLogoPanel clipId="c1" rects={[rect()]} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it('borrar máscara queda deshabilitado sin selección', () => {
    render(<RemoveLogoPanel clipId="c1" rects={[rect()]} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Borrar máscara' })).toBeDisabled();
  });

  it('dibuja una máscara nueva con el puntero', () => {
    const onApply = vi.fn();
    render(<RemoveLogoPanel clipId="c1" rects={[]} onApply={onApply} />);
    const zone = screen.getByRole('application');
    fireEvent.pointerDown(zone, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(zone, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(zone, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).toHaveBeenCalled();
    const applied = onApply.mock.calls[0][0] as DelogoRect[];
    expect(applied).toHaveLength(1);
    expect(applied[0].width).toBeGreaterThan(0);
    expect(applied[0].height).toBeGreaterThan(0);
  });

  it('rechaza máscaras degeneradas con mensaje en español', () => {
    const onApply = vi.fn();
    render(<RemoveLogoPanel clipId="c1" rects={[rect({ width: 0.001, height: 0.2 })]} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('demasiado pequeña');
  });

  it('indica que la preview es aproximada', () => {
    render(<RemoveLogoPanel clipId="c1" rects={[]} onApply={vi.fn()} />);
    expect(screen.getByText(/aproximada/)).toBeInTheDocument();
  });

  it('no promete reconstrucción con IA ni tracking', () => {
    render(<RemoveLogoPanel clipId="c1" rects={[]} onApply={vi.fn()} />);
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/\bIA\b|inteligencia artificial|seguimiento autom/i);
  });
});
