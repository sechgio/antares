import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
