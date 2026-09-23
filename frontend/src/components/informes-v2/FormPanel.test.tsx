import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('muestra los campos de la plantilla clásica sin conmutador en el panel', () => {
    const report = createEmptyClientReport(1);

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
        onLogoChange={vi.fn()}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    expect(screen.getByText('Línea')).toBeInTheDocument();
    expect(screen.queryByText('Contratista')).not.toBeInTheDocument();

    // el conmutador de plantilla vive en el header de la app, no en el panel
    expect(screen.queryByRole('group', { name: 'Plantilla' })).not.toBeInTheDocument();
  });

  it('edita la inspección de la plantilla Reservorios 2', () => {
    const report = createEmptyClientReport(1);
    report.plantilla = 'reservorios2';
    const onChange = vi.fn();

    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft={null}
        logoRight={null}
        photoCount={0}
        onChange={onChange}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={vi.fn()}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Ubicación')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SGIO')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contratista')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Código de infraestructura')).not.toBeInTheDocument();
    expect(screen.getByText('CAJA DE REGISTRO')).toBeInTheDocument();
    expect(screen.getByText('ESCALERA · INTERIOR')).toBeInTheDocument();
    expect(screen.getAllByText('DESAGÜE').length).toBeGreaterThan(0);
    expect(screen.queryByText('Línea')).not.toBeInTheDocument();

    const firstRow = screen.getByText('CAJA DE REGISTRO').closest('.tr-insp-row');
    fireEvent.click(screen.getByText('Inspección').closest('button') as HTMLElement);
    fireEvent.click(within(firstRow as HTMLElement).getByRole('button', { name: 'CAJA DE REGISTRO: Crítico' }));
    expect(within(firstRow as HTMLElement).getByRole('button', { name: 'CAJA DE REGISTRO: Crítico' })).toBeInTheDocument();

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reservorios2: expect.objectContaining({
          inspeccion: expect.objectContaining({
            caja_registro: {
              normal: false,
              critico: true,
              observaciones: '',
              sugerencias: '',
            },
          }),
        }),
      }),
    );
  });

  it('clears an imported total override when its row total is edited', () => {
    const report = createEmptyClientReport(2);
    report.plantilla = 'reservorios2';
    report.reservorios2.valvulas_totales = { oper: 8, no_op: 2 };
    const onChange = vi.fn();

    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft={null}
        logoRight={null}
        photoCount={0}
        onChange={onChange}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={vi.fn()}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Válvulas').closest('button') as HTMLElement);
    const conduccion = screen.getByText('CONDUCCIÓN').closest('.tr-diameter-row') as HTMLElement;
    fireEvent.change(within(conduccion).getByLabelText('OPER.'), { target: { value: '3' } });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reservorios2: expect.objectContaining({
          valvulas_totales: { oper: null, no_op: 2 },
        }),
      }),
    );
  });

  it('permite editar los cuatro textos de medidas de la plantilla Nueva', () => {
    const report = createEmptyClientReport(3);
    report.plantilla = 'reservorios2';
    const onChange = vi.fn();

    render(
      <FormPanel
        report={report}
        hasChanges={false}
        busy={false}
        logoLeft={null}
        logoRight={null}
        photoCount={0}
        onChange={onChange}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onLogoChange={vi.fn()}
        onPhotosChange={vi.fn()}
        onClearPhotos={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Medidas').closest('button') as HTMLElement);
    fireEvent.change(screen.getByLabelText('Texto de altura útil'), {
      target: { value: 'PROFUNDIDAD UTIL' },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reservorios2: expect.objectContaining({
          medidas: expect.objectContaining({ etiqueta_altura_util: 'PROFUNDIDAD UTIL' }),
        }),
      }),
    );
    fireEvent.click(screen.getByText('Medidas').closest('button') as HTMLElement);
    expect(screen.getByLabelText('Texto de diámetro')).toBeInTheDocument();
    expect(screen.getByLabelText('Texto de diámetro interno')).toBeInTheDocument();
    expect(screen.getByLabelText('Texto de altura total')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /^Cantidad \(M\) —/ })).toHaveLength(4);
    expect(screen.getByRole('textbox', { name: 'Cantidad (M) — diámetro' })).toBeInTheDocument();
  });
});
