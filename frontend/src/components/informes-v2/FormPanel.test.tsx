import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FormPanel from './FormPanel';
import { createEmptyClientReport } from './testFixtures';

describe('Informes v2 FormPanel', () => {
  it('exposes logo file inputs and opens section fields', () => {
    const report = createEmptyClientReport(1);
    const onLogoChange = vi.fn();

    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft={null}
        logoRight={null}
        photoCount={0}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={onLogoChange}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    expect(screen.getByText('Logo izq')).toBeInTheDocument();
    expect(screen.getByText('Logo der')).toBeInTheDocument();
    expect(screen.getAllByText(/PNG · JPG · WebP/)).toHaveLength(2);

    const logoInputs = document.querySelectorAll('.tr-logo-chip-hit input[type="file"]');
    expect(logoInputs).toHaveLength(2);

    const file = new File(['logo'], 'logo.png', { type: 'image/png' });
    fireEvent.change(logoInputs[0], { target: { files: [file] } });
    expect(onLogoChange).toHaveBeenCalledWith('left', file);

    expect(screen.getByLabelText('Estación')).toBeInTheDocument();
    expect(screen.getByLabelText('ID de imágenes')).toBeInTheDocument();
  });

  it('shows clear control when a logo is set', () => {
    const report = createEmptyClientReport(1);
    const onLogoChange = vi.fn();

    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft="data:image/png;base64,abc"
        logoRight={null}
        photoCount={0}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={onLogoChange}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Quitar logo izquierdo'));
    expect(onLogoChange).toHaveBeenCalledWith('left', null);
  });
});
