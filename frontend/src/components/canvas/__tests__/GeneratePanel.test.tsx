import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import { createEmptyDocument } from '../types';
import { selectGenerateRowIndices } from '../ops/generateExport';
import GeneratePanel from '../editor/GeneratePanel';

const canvasGet = vi.fn();
const canvasList = vi.fn();

vi.mock('../../../api', () => ({
  api: {
    canvasList: (...args: unknown[]) => canvasList(...args),
    canvasGet: (...args: unknown[]) => canvasGet(...args),
    dialogSave: vi.fn(),
    htmlToPdf: vi.fn(),
  },
}));

function docWithLayers(name: string, id?: string) {
  const doc = createEmptyDocument(name);
  if (id) doc.id = id;
  const field = createLayer('field');
  field.meta = { key: 'NIS', fallback: '-' };
  doc.layers.push(field);
  return doc;
}

describe('selectGenerateRowIndices', () => {
  const rows = [
    { ID: 'A-1', NIS: '1' },
    { ID: 'B-2', NIS: '2' },
    { ID: 'C-3', NIS: '3' },
  ];

  it('exports all rows when images are not required', () => {
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'all',
        idColumn: 'ID',
        requiresImages: false,
        images: [],
      }),
    ).toEqual([0, 1, 2]);
  });

  it('skips rows without matching images when required', () => {
    const images = [new File(['x'], 'A-1_1.jpg', { type: 'image/jpeg' })];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'all',
        idColumn: 'ID',
        requiresImages: true,
        images,
      }),
    ).toEqual([0]);
  });

  it('returns empty for single row without matching images when required', () => {
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 1,
        exportScope: 'single',
        idColumn: 'ID',
        requiresImages: true,
        images: [new File(['x'], 'A-1.jpg', { type: 'image/jpeg' })],
      }),
    ).toEqual([]);
  });
});

describe('GeneratePanel wizard', () => {
  beforeEach(() => {
    canvasList.mockReset();
    canvasGet.mockReset();
    canvasList.mockResolvedValue({
      documents: [
        { id: 'doc-design', name: 'Diseño actual' },
        { id: 'doc-other', name: 'Otra plantilla' },
      ],
    });
    canvasGet.mockResolvedValue({
      document: docWithLayers('Otra plantilla', 'doc-other'),
    });
  });

  it('renders the 6-step workflow and lists canvas templates', async () => {
    const design = docWithLayers('Diseño actual', 'doc-design');
    render(<GeneratePanel document={design} />);

    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('Logos y Cabecera')).toBeTruthy();
    expect(screen.getByText('Plantilla')).toBeTruthy();
    expect(screen.getByText('Datos')).toBeTruthy();
    expect(screen.getByText('Mapeo de Columnas')).toBeTruthy();
    expect(screen.getByText('Imágenes')).toBeTruthy();
    expect(screen.getByText('Seleccionar y Exportar')).toBeTruthy();

    const picker = await screen.findByLabelText('Elegir plantilla Canvas');
    await waitFor(() => {
      expect(picker.querySelectorAll('option')).toHaveLength(2);
    });
    expect(screen.getByText(/Diseño actual · 1 capas/)).toBeTruthy();
  });

  it('lists templates via canvasList without calling runCloudSync on mount', async () => {
    const runCloudSync = vi.fn().mockResolvedValue(undefined);
    const design = docWithLayers('Diseño actual', 'doc-design');
    render(<GeneratePanel document={design} runCloudSync={runCloudSync} />);

    await waitFor(() => expect(canvasList).toHaveBeenCalled());
    expect(runCloudSync).not.toHaveBeenCalled();
  });

  it('syncs generate preview when the design document changes', async () => {
    const design = docWithLayers('Diseño actual', 'doc-design');
    const { rerender } = render(<GeneratePanel document={design} />);

    await waitFor(() => expect(screen.getByText(/Diseño actual · 1 capas/)).toBeTruthy());

    const updated = docWithLayers('Diseño actual', 'doc-design');
    updated.layers.push(createLayer('text', { name: 'Nuevo', value: 'Hola' }));

    rerender(<GeneratePanel document={updated} />);

    await waitFor(() => {
      expect(screen.getByText(/Diseño actual · 2 capas/)).toBeTruthy();
    });
  });

  it('empty preview uses LayerNode page matching design chrome for panel fotográfico', async () => {
    const { createReportPreset } = await import('../presets/panels');
    const doc = createReportPreset();
    doc.id = 'doc-preset';
    render(<GeneratePanel document={doc} />);

    await waitFor(
      () => {
        const page = document.querySelector('[data-testid="page-layer-preview"]');
        expect(page).toBeTruthy();
        const text = page?.textContent ?? '';
        expect(text).toContain('PANEL FOTOGRÁFICO');
        expect(text).toContain('1.0 LOCALIZACIÓN');
        expect(text).toContain('3.0 PANEL FOTOGRÁFICO');
        expect(text).toContain('Grid 3×2');
        expect(text).toContain('Logo L');
        expect(text).toContain('Foto 1');
        expect(text).toContain('-');
      },
      { timeout: 4000 },
    );
  });

  it('renders one PageLayerPreview per image page for a 2×2 grid with 9 photos', async () => {
    const doc = createEmptyDocument('Multi gen');
    doc.id = 'doc-multi';
    const gridId = 'grid-1';
    doc.layers.push({
      id: gridId,
      type: 'grid',
      name: 'Grid',
      value: '',
      pageIndex: 0,
      cssVars: {},
      meta: { cols: 2, rows: 2 },
    });
    for (let i = 0; i < 4; i += 1) {
      doc.layers.push(createLayer('imageSlot', { meta: { index: i }, parentId: gridId }));
    }

    const { container } = render(<GeneratePanel document={doc} />);

    const excelInput = container.querySelector('input[accept=".csv,.xlsx,.xls"]') as HTMLInputElement;
    fireEvent.change(excelInput, {
      target: {
        files: [new File(['ID,NIS\nA-1,100'], 'datos.csv', { type: 'text/csv' })],
      },
    });
    await waitFor(() => expect(screen.getByText('1 registros cargados')).toBeTruthy());

    const imageInputs = container.querySelectorAll('input[accept="image/*"]');
    const imageInput = imageInputs[imageInputs.length - 1] as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: Array.from({ length: 9 }, (_, i) =>
          new File([`img${i}`], `A-1-${i + 1}.jpg`, { type: 'image/jpeg' }),
        ),
      },
    });

    await waitFor(
      () => {
        expect(document.querySelectorAll('[data-testid="page-layer-preview"]')).toHaveLength(3);
      },
      { timeout: 4000 },
    );
  });

  it('loads another canvas template without calling canvasGet for the design doc', async () => {
    const design = docWithLayers('Diseño actual', 'doc-design');
    render(<GeneratePanel document={design} />);

    const picker = await screen.findByLabelText('Elegir plantilla Canvas');
    await waitFor(() => expect(picker.querySelectorAll('option')).toHaveLength(2));

    fireEvent.change(picker, { target: { value: 'doc-other' } });

    await waitFor(() => expect(canvasGet).toHaveBeenCalledWith('doc-other'));
    await waitFor(() => {
      expect(screen.getByText(/Otra plantilla · 1 capas/)).toBeTruthy();
    });

    fireEvent.change(picker, { target: { value: 'doc-design' } });
    await waitFor(() => {
      expect(screen.getByText(/Diseño actual · 1 capas/)).toBeTruthy();
    });
    expect(canvasGet).toHaveBeenCalledTimes(1);
  });

  it('parses excel into the datos step', async () => {
    const design = docWithLayers('Diseño actual', 'doc-design');
    const { container } = render(<GeneratePanel document={design} />);

    const fileInput = container.querySelector('input[accept=".csv,.xlsx,.xls"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['ID,NIS\nA-1,100\nB-2,200'], 'datos.csv', { type: 'text/csv' })],
      },
    });

    await waitFor(() => expect(screen.getByText('2 registros cargados')).toBeTruthy());
    expect(screen.getByText('4/6')).toBeTruthy();
  });

  it('opens column mapping and shows all field keys after excel load', async () => {
    const design = createEmptyDocument('Multi campos');
    design.id = 'doc-design';
    for (const key of ['CENTRO', 'NIS', 'SECTOR', 'FECHA CORTE', 'DIRECCIONES AFECTADAS']) {
      const field = createLayer('field');
      field.meta = { key, fallback: '-' };
      design.layers.push(field);
    }

    const { container } = render(<GeneratePanel document={design} />);

    const fileInput = container.querySelector('input[accept=".csv,.xlsx,.xls"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(
            ['ID,CENTRO,NIS,SECTOR,FECHA CORTE,DIRECCIONES AFECTADAS\n1,A,100,N,2024-01-01,Calle 1'],
            'datos.csv',
            { type: 'text/csv' },
          ),
        ],
      },
    });

    await waitFor(() => expect(screen.getByText('1 registros cargados')).toBeTruthy());

    await waitFor(() => {
      const heading = screen.getByText('Mapeo de Columnas');
      const toggle = heading.closest('button');
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    });

    expect(screen.getByLabelText('Columna ID (Clave)')).toBeTruthy();
    for (const key of ['CENTRO', 'NIS', 'SECTOR', 'FECHA CORTE', 'DIRECCIONES AFECTADAS']) {
      expect(screen.getByLabelText(`Mapeo ${key}`)).toBeTruthy();
    }

    // Open ID column dropdown — every Excel header must be reachable via portal
    const idSelect = screen.getByLabelText('Columna ID (Clave)');
    const idTrigger = idSelect.parentElement?.querySelector('button[aria-expanded]') as HTMLButtonElement;
    fireEvent.click(idTrigger);
    await waitFor(() => {
      const listbox = screen.getByRole('listbox');
      expect(within(listbox).getByRole('option', { name: 'CENTRO' })).toBeTruthy();
      expect(within(listbox).getByRole('option', { name: 'DIRECCIONES AFECTADAS' })).toBeTruthy();
    });
  });

  it('includes checkbox, signature and table field keys in mapping', async () => {
    const design = createEmptyDocument('Widgets');
    design.id = 'doc-design';
    design.layers.push(
      { ...createLayer('field'), meta: { key: 'NIS', fallback: '-' } },
      { ...createLayer('checkbox'), meta: { key: 'OK' } },
      { ...createLayer('signature'), meta: { key: 'FIRMA' } },
      {
        ...createLayer('table'),
        meta: {
          rowsData: JSON.stringify({
            cells: [['', '']],
            fieldKeys: [[null, 'DIRECCION']],
          }),
        },
      },
    );

    const { container } = render(<GeneratePanel document={design} />);

    const fileInput = container.querySelector('input[accept=".csv,.xlsx,.xls"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['ID,NIS,OK,FIRMA,DIRECCION\n1,100,1,JP,Calle 1'], 'datos.csv', {
            type: 'text/csv',
          }),
        ],
      },
    });

    await waitFor(() => expect(screen.getByText('1 registros cargados')).toBeTruthy());

    for (const key of ['NIS', 'OK', 'FIRMA', 'DIRECCION']) {
      expect(screen.getByLabelText(`Mapeo ${key}`)).toBeTruthy();
    }
  });
});
