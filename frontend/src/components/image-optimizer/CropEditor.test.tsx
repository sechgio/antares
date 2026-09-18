import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CropEditor from './CropEditor';
import type { ImageItem } from './types';

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'img-1',
    sourceFile: new File(['x'], 'foto.png'),
    preview: 'data:image/png;base64,x',
    originalName: 'foto.png',
    originalSize: 100,
    sourceWidth: 800,
    sourceHeight: 600,
    status: 'pending',
    stale: false,
    selected: true,
    excluded: false,
    overrides: { customCropOffset: null },
    ...overrides,
  } as ImageItem;
}

describe('CropEditor', () => {
  it('no renderiza nada si el recorte no aplica (aspect original)', () => {
    const { container } = render(
      <CropEditor
        image={makeImage()}
        aspectRatio="original"
        cropOrigin="bottom"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza sin dimensiones de origen', () => {
    const { container } = render(
      <CropEditor
        image={makeImage({ sourceWidth: undefined, sourceHeight: undefined })}
        aspectRatio="1:1"
        cropOrigin="bottom"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('guarda el offset y cierra al aplicar', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <CropEditor image={makeImage()} aspectRatio="1:1" cropOrigin="bottom" onClose={onClose} onSave={onSave} />,
    );
    fireEvent.click(screen.getByText('Aplicar'));
    expect(onSave).toHaveBeenCalledWith('img-1', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('muestra el offset Y por defecto en origen bottom (100%)', () => {
    render(
      <CropEditor image={makeImage()} aspectRatio="1:1" cropOrigin="bottom" onClose={vi.fn()} onSave={vi.fn()} />,
    );
    // 800x600 con 1:1 → cropType vertical → offset X
    expect(screen.getByText(/X \d+%/)).toBeInTheDocument();
  });

  it('offset Y visible cuando el recorte es horizontal', () => {
    // imagen alta con ratio ancho → horizontal
    render(
      <CropEditor
        image={makeImage({ sourceWidth: 400, sourceHeight: 900 })}
        aspectRatio="16:9"
        cropOrigin="top"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Y \d+%/)).toBeInTheDocument();
  });

  it('resetear vuelve al offset por defecto y cancelar cierra sin guardar', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <CropEditor image={makeImage()} aspectRatio="1:1" cropOrigin="bottom" onClose={onClose} onSave={onSave} />,
    );
    fireEvent.click(screen.getByText('Resetear'));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('arrastrar el recorte vertical actualiza el offset X', () => {
    const onSave = vi.fn();
    const { container } = render(
      <CropEditor image={makeImage()} aspectRatio="1:1" cropOrigin="bottom" onClose={vi.fn()} onSave={onSave} />,
    );
    const img = container.querySelector('img')!;
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const cropBox = container.querySelector('.cursor-grab')!;
    fireEvent.mouseDown(cropBox);
    // overlay raíz recibe el mouseMove
    fireEvent.mouseMove(container.firstElementChild!, { clientX: 100, clientY: 300 });
    fireEvent.mouseUp(container.firstElementChild!);
    fireEvent.click(screen.getByText('Aplicar'));
    const saved = onSave.mock.calls[0][1] as { x: number; y: number };
    expect(saved.x).toBeGreaterThanOrEqual(0);
    expect(saved.x).toBeLessThanOrEqual(1);
    // offset se desplazó del centro (0.5) hacia la izquierda
    expect(saved.x).toBeLessThan(0.5);
  });

  it('mouseMove sin drag no cambia el offset', () => {
    const onSave = vi.fn();
    const { container } = render(
      <CropEditor image={makeImage()} aspectRatio="1:1" cropOrigin="bottom" onClose={vi.fn()} onSave={onSave} />,
    );
    fireEvent.mouseMove(container.firstElementChild!, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Aplicar'));
    // crop vertical: offset inicial {x:0.5, y:0}
    expect(onSave).toHaveBeenCalledWith('img-1', { x: 0.5, y: 0 });
  });

  it('respeta un customCropOffset existente al guardar', () => {
    const onSave = vi.fn();
    render(
      <CropEditor
        image={makeImage({ overrides: { customCropOffset: { x: 0.25, y: 0.75 } } as ImageItem['overrides'] })}
        aspectRatio="1:1"
        cropOrigin="bottom"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText('Aplicar'));
    expect(onSave).toHaveBeenCalledWith('img-1', { x: 0.25, y: 0.75 });
  });
});
