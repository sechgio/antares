import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AgentReasoningEffort } from '../../api/agentApi';
import ReasoningPicker from './ReasoningPicker';

const levels: AgentReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

it('muestra el modelo y previsualiza el esfuerzo sin guardarlo hasta soltar', () => {
  const change = vi.fn();
  render(<ReasoningPicker levels={levels} value="low" model="modelo-actual" onChange={change} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Bajo' }));
  expect(screen.getByText('modelo-actual')).toBeVisible();
  const slider = screen.getByRole('slider', { name: 'Nivel de razonamiento' });
  expect(slider).toHaveFocus();
  fireEvent.change(slider, { target: { value: '5' } });
  expect(slider).toHaveAttribute('aria-valuetext', 'Máximo');
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  expect(change).toHaveBeenCalledExactlyOnceWith('max');
});

it('guarda con teclado solo si cambia el nivel efectivo', () => {
  const change = vi.fn();
  render(<ReasoningPicker levels={['low', 'medium', 'high']} value="max" model="modelo" onChange={change} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Alto' }));
  const slider = screen.getByRole('slider');
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(slider, { target: { value: '1' } });
  fireEvent.keyUp(slider, { key: 'ArrowLeft' });
  expect(change).toHaveBeenCalledExactlyOnceWith('medium');
});

it.each([
  { supported: levels, expected: 'low', label: 'Bajo' },
  { supported: ['high', 'xhigh', 'max'] satisfies AgentReasoningEffort[], expected: 'high', label: 'Alto' },
])('restablece al valor predeterminado compatible: $label', ({ supported, expected, label }) => {
  const change = vi.fn();
  render(<ReasoningPicker levels={supported} value="max" model="modelo" onChange={change} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Máximo' }));
  fireEvent.click(screen.getByRole('button', { name: `Restablecer razonamiento a ${label}` }));
  expect(change).toHaveBeenCalledExactlyOnceWith(expected);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', label);
});

it('cancela la previsualización con Escape y devuelve el foco', () => {
  const change = vi.fn();
  render(<ReasoningPicker levels={levels} value="low" model="modelo" onChange={change} disabled={false} />);
  const trigger = screen.getByRole('button', { name: 'Razonamiento: Bajo' });
  fireEvent.click(trigger);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '5' } });
  fireEvent.keyDown(slider, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  expect(screen.getByRole('slider')).toHaveValue('1');
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cierra cuando el foco sale del selector o se deshabilita', () => {
  const change = vi.fn();
  const { rerender } = render(<ReasoningPicker levels={levels} value="low" model="modelo" onChange={change} disabled={false} />);
  const trigger = screen.getByRole('button', { name: 'Razonamiento: Bajo' });
  fireEvent.click(trigger);
  fireEvent.blur(screen.getByRole('slider'), { relatedTarget: document.body });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  rerender(<ReasoningPicker levels={levels} value="low" model="modelo" onChange={change} disabled />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});

it('deshabilita la barra y el restablecimiento cuando solo hay un nivel', () => {
  render(<ReasoningPicker levels={['high']} value="max" model="modelo" onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Alto' }));
  expect(screen.getByRole('slider')).toBeDisabled();
  expect(screen.getByRole('slider')).toHaveAttribute('max', '0');
  expect(screen.getByRole('button', { name: 'Restablecer razonamiento a Alto' })).toBeDisabled();
});
