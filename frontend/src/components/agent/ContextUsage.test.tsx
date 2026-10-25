import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ContextUsage, { contextWindowFor, formatCost, formatTokens } from './ContextUsage';

it('muestra el porcentaje de la ventana de contexto y el desglose al pasar el cursor', () => {
  render(<ContextUsage usage={{ input: 30000, output: 2000 }} model="gpt-4o-mini" />);
  const trigger = screen.getByRole('button', { name: 'Contexto usado' });
  expect(trigger).toHaveTextContent('25%');
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseEnter(trigger);
  const card = screen.getByRole('tooltip');
  expect(card).toHaveTextContent('32 k / 128 k');
  expect(card).toHaveTextContent('Entrada30 kSalida2 k');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  fireEvent.mouseLeave(trigger);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('calcula la ocupación con el último turno y deja el acumulado en el desglose', () => {
  render(<ContextUsage usage={{ input: 90000, output: 4000, context: 64000 }} model="claude-sonnet-4" />);
  const trigger = screen.getByRole('button', { name: 'Contexto usado' });
  expect(trigger).toHaveTextContent('32%');
  fireEvent.mouseEnter(trigger);
  expect(screen.getByRole('tooltip')).toHaveTextContent('64 k / 200 k');
  expect(screen.getByRole('tooltip')).toHaveTextContent('Entrada90 kSalida4 k');
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('En caché');
});

it('no muestra la caché cuando el proveedor no la usa', () => {
  render(<ContextUsage usage={{ input: 20000, output: 1000, cached: 0, prompt: 20000 }} model="llama3.1:8b" />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Contexto usado' }));
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('En caché');
});

it('muestra cuánto del prompt se sirvió desde la caché del proveedor', () => {
  render(<ContextUsage usage={{ input: 20000, output: 1000, cached: 60000, prompt: 80000 }} model="claude-sonnet-4" />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Contexto usado' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent('En caché60 k · 75%');
});

it('sin ventana conocida muestra solo los tokens y nada si no hay uso', () => {
  const { rerender } = render(<ContextUsage usage={{ input: 1500, output: 200 }} model="modelo-propio" />);
  expect(screen.getByRole('button', { name: 'Contexto usado' })).toHaveTextContent('1,7 k');
  fireEvent.focus(screen.getByRole('button', { name: 'Contexto usado' }));
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<ContextUsage usage={null} model="gpt-4o" />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('muestra el coste del turno y de la sesión con la ventana real del modelo', () => {
  render(<ContextUsage usage={{
    input: 100_000, output: 10_000, context: 50_000, cost: 0.0125,
    turn: { input: 20_000, output: 1000, cost: 0.0031 }, window: 64_000, compactions: 2,
  }} model="modelo-propio" />);
  const trigger = screen.getByRole('button', { name: 'Contexto usado' });
  expect(trigger).toHaveTextContent('78,1%');
  expect(trigger).toHaveTextContent('$0,0125');
  fireEvent.mouseEnter(trigger);
  const card = screen.getByRole('tooltip');
  expect(card).toHaveTextContent('50 k / 64 k');
  expect(card).toHaveTextContent('Último turno20 k ent. · 1 k sal.');
  expect(card).toHaveTextContent('Coste del turno$0,0031');
  expect(card).toHaveTextContent('Coste de la sesión$0,0125');
  expect(card).toHaveTextContent('Compactaciones2');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '78');
});

it('no inventa coste cuando el proveedor no lo informa', () => {
  render(<ContextUsage usage={{ input: 1500, output: 200, context: 1500 }} model="modelo-propio" />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Contexto usado' }));
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('Coste');
});

it('resuelve ventanas y formatea tokens', () => {
  expect(contextWindowFor('claude-sonnet-4')).toBe(200_000);
  expect(contextWindowFor('llama3.1:8b')).toBe(128_000);
  expect(contextWindowFor('desconocido')).toBeNull();
  expect(formatTokens(999)).toBe('999');
  expect(formatTokens(1_048_576)).toBe('1 M');
  expect(formatCost(0.0031)).toBe('$0,0031');
  expect(formatCost(1.5)).toBe('$1,50');
  expect(formatCost(0.00001)).toBe('<$0,0001');
});
