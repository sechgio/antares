import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextPanel } from './TextPanel';
import { AudioPanel } from './AudioPanel';
import type { Clip } from '../types';

function baseClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 'track-v',
    kind: 'text',
    timelineStartUs: 0,
    sourceInUs: 0,
    sourceOutUs: 2_000_000,
    speed: { num: 1, den: 1 },
    transform: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      canvasX: 0,
      canvasY: 0,
      canvasW: 1,
      canvasH: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      fit: 'fit',
    },
    audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 0, fadeInUs: 0, fadeOutUs: 0, effects: [] },
    delogo: { rects: [] },
    text: {
      content: 'Hola',
      fontId: 'dejavu-sans',
      fontSizePx: 48,
      color: '#FFFFFF',
      align: 'center',
      box: { x: 0, y: 0.4, width: 1, height: 0.2 },
      style: { bold: false, italic: false, underline: false, strokeWidthPx: 0 },
      entryPreset: { type: 'none', durationUs: 0 },
      exitPreset: { type: 'none', durationUs: 0 },
    },
    effects: [],
    ...overrides,
  };
}

describe('TextPanel', () => {
  it('muestra el contenido del clip seleccionado', () => {
    render(<TextPanel clip={baseClip()} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Hola')).toBeInTheDocument();
  });

  it('pide selección cuando no hay clip de texto', () => {
    render(<TextPanel clip={null} onChange={vi.fn()} />);
    expect(screen.getByText(/Selecciona un clip de texto/)).toBeInTheDocument();
  });

  it('edita el contenido por mutación del borrador', () => {
    const onChange = vi.fn();
    render(<TextPanel clip={baseClip()} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Hola'), { target: { value: 'Adiós' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.text?.content).toBe('Adiós');
  });

  it('cambia la alineación', () => {
    const onChange = vi.fn();
    render(<TextPanel clip={baseClip()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'left' }));
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.text?.align).toBe('left');
  });

  it('marca la alineación activa', () => {
    render(<TextPanel clip={baseClip()} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'center' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'left' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('cambia el tamaño de fuente', () => {
    const onChange = vi.fn();
    render(<TextPanel clip={baseClip()} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('48 px'), { target: { value: '96' } });
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.text?.fontSizePx).toBe(96);
  });

  it('alterna negrita', () => {
    const onChange = vi.fn();
    render(<TextPanel clip={baseClip()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Negrita'));
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.text?.style.bold).toBe(true);
  });
});

describe('AudioPanel', () => {
  it('muestra la ganancia del clip', () => {
    render(<AudioPanel clip={baseClip()} onChange={vi.fn()} />);
    expect(screen.getByText('Ganancia: 0 dB')).toBeInTheDocument();
  });

  it('pide selección cuando no hay clip con audio', () => {
    render(<AudioPanel clip={null} onChange={vi.fn()} />);
    expect(screen.getByText(/Selecciona un clip con audio/)).toBeInTheDocument();
  });

  it('cambia la ganancia por mutación del borrador', () => {
    const onChange = vi.fn();
    render(<AudioPanel clip={baseClip()} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: /Ganancia/ });
    fireEvent.change(slider, { target: { value: '-6' } });
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.audio.gainDb).toBe(-6);
  });

  it('desactiva el audio embebido', () => {
    const onChange = vi.fn();
    render(<AudioPanel clip={baseClip()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Audio embebido'));
    const mutate = onChange.mock.calls[0][0];
    const draft = baseClip();
    mutate(draft);
    expect(draft.audio.embeddedEnabled).toBe(false);
  });

  it('avisa de saturación con ganancia alta', () => {
    const clip = baseClip({ audio: { streamIndex: 0, embeddedEnabled: true, gainDb: 18, fadeInUs: 0, fadeOutUs: 0, effects: [] } });
    render(<AudioPanel clip={clip} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('puede saturar');
  });
});
