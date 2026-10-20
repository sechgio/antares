import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ContextUsage, { contextWindowFor, formatTokens } from './ContextUsage';

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

it('sin ventana conocida muestra solo los tokens y nada si no hay uso', () => {
  const { rerender } = render(<ContextUsage usage={{ input: 1500, output: 200 }} model="modelo-propio" />);
  expect(screen.getByRole('button', { name: 'Contexto usado' })).toHaveTextContent('1,7 k');
  fireEvent.focus(screen.getByRole('button', { name: 'Contexto usado' }));
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<ContextUsage usage={null} model="gpt-4o" />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('resuelve ventanas y formatea tokens', () => {
  expect(contextWindowFor('claude-sonnet-4')).toBe(200_000);
  expect(contextWindowFor('llama3.1:8b')).toBe(128_000);
  expect(contextWindowFor('desconocido')).toBeNull();
  expect(formatTokens(999)).toBe('999');
  expect(formatTokens(1_048_576)).toBe('1 M');
});
