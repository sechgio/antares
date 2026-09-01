import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PanelImageUploader from '../panel-aviso-corte/components/ImageUploader';
import EvidenceImageUploader from '../evidencia-volanteo/components/ImageUploader';
import PhotoManager from '../reportes-campo/components/PhotoManager';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => false,
}));

function expectKeyboardOpensFilePicker(dropzone: HTMLElement) {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click');
  click.mockClear();

  fireEvent.keyDown(dropzone, { key: 'Enter' });
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dropzone, { key: ' ' });

  expect(click).toHaveBeenCalledTimes(2);
  click.mockRestore();
}

describe('image upload dropzones', () => {
  it('opens the Panel Aviso de Corte picker from the keyboard', () => {
    render(<PanelImageUploader images={[]} onAdd={() => []} onRemove={() => {}} onClear={() => {}} />);

    const dropzone = screen.getByRole('button', { name: 'Cargar imágenes' });
    expect(dropzone).toHaveAttribute('tabindex', '0');
    expectKeyboardOpensFilePicker(dropzone);
  });

  it('opens the Evidencia Volanteo picker from the keyboard', () => {
    render(<EvidenceImageUploader images={[]} onAdd={() => []} onRemove={() => {}} onClear={() => {}} />);

    const dropzone = screen.getByRole('button', { name: 'Cargar lote de fotos' });
    expect(dropzone).toHaveAttribute('tabindex', '0');
    expectKeyboardOpensFilePicker(dropzone);
  });

  it('opens the Reportes de Campo picker from the keyboard', () => {
    render(
      <PhotoManager
        photos={[]}
        maxPhotos={5}
        onAdd={() => {}}
        onClear={() => {}}
        totalPages={0}
        isDragging={false}
        onDragOver={() => {}}
        onDragEnter={() => {}}
        onDragLeave={() => {}}
        onDrop={() => {}}
      />,
    );

    const dropzone = screen.getByRole('button', { name: 'Agregar imágenes' });
    expect(dropzone).toHaveAttribute('tabindex', '0');
    expectKeyboardOpensFilePicker(dropzone);
  });

  it('removes the full Reportes de Campo dropzone from the tab order', () => {
    const photos = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      file: new File(['photo'], `photo-${index}.jpg`, { type: 'image/jpeg' }),
      previewUrl: `blob:photo-${index}`,
    }));
    render(
      <PhotoManager
        photos={photos}
        maxPhotos={5}
        onAdd={() => {}}
        onClear={() => {}}
        totalPages={1}
        isDragging={false}
        onDragOver={() => {}}
        onDragEnter={() => {}}
        onDragLeave={() => {}}
        onDrop={() => {}}
      />,
    );

    const dropzone = screen.getByRole('button', { name: 'Límite alcanzado (5 imágenes)' });
    expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    expect(dropzone).toHaveAttribute('tabindex', '-1');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    click.mockClear();
    fireEvent.keyDown(dropzone, { key: 'Enter' });
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
