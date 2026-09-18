import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GenerateSidebar, { type GenerateSidebarProps } from '../editor/GenerateSidebar';

function makeFile(name: string, type = 'image/png'): File {
  return new File(['x'], name, { type });
}

function makeProps(overrides: Partial<GenerateSidebarProps> = {}): GenerateSidebarProps {
  return {
    stepStates: [false, false, false, false, false, false],
    completedCount: 0,
    logoLeft: null,
    logoRight: null,
    onLogoLeft: vi.fn(),
    onLogoRight: vi.fn(),
    templateValid: true,
    templateOptions: [
      { id: 't1', name: 'Plantilla A', updatedAt: '' },
      { id: 't2', name: 'Plantilla B', updatedAt: '' },
    ],
    selectedTemplateId: 't1',
    onSelectTemplate: vi.fn(),
    templateName: 'Plantilla A',
    layerCount: 4,
    fieldKeys: [],
    requiresImages: false,
    onRequiresImages: vi.fn(),
    rows: [],
    headers: [],
    idColumn: '',
    onIdColumn: vi.fn(),
    mappings: {},
    onMapping: vi.fn(),
    images: [],
    onImages: vi.fn(),
    onAppendImages: vi.fn(),
    dragData: false,
    setDragData: vi.fn(),
    dragImages: false,
    setDragImages: vi.fn(),
    onExcel: vi.fn(),
    searchOrder: '',
    onSearchOrder: vi.fn(),
    rowIndex: 0,
    onRowIndex: vi.fn(),
    exportScope: 'single',
    onExportScope: vi.fn(),
    pdfQuality: 'high',
    onPdfQuality: vi.fn(),
    colorMode: 'rgb',
    onColorMode: vi.fn(),
    colorProfile: 'cmyk_iso_coated_v2',
    onColorProfile: vi.fn(),
    bleedMm: 3,
    onBleedMm: vi.fn(),
    showCropMarks: false,
    onShowCropMarks: vi.fn(),
    showPlaceholders: true,
    onShowPlaceholders: vi.fn(),
    busy: false,
    onExport: vi.fn(),
    onPrint: vi.fn(),
    error: null,
    ...overrides,
  };
}

function selectOption(ariaLabel: string, optionName: string) {
  const trigger = screen.getByLabelText(ariaLabel).parentElement!.querySelector('button')!;
  fireEvent.click(trigger);
  const listbox = screen.getByRole('listbox', { name: ariaLabel });
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
}

describe('GenerateSidebar', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  });

  it('muestra el progreso con aria-valuenow y contador N/6', () => {
    render(<GenerateSidebar {...makeProps({ completedCount: 3, stepStates: [true, true, true, false, false, false] })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '6');
    expect(screen.getByText('3/6')).toBeInTheDocument();
  });

  it('al elegir logo izquierdo invoca onLogoLeft con url y archivo', () => {
    const props = makeProps();
    render(<GenerateSidebar {...props} />);
    const file = makeFile('logo.png');
    fireEvent.change(document.getElementById('canvasLogoLeft')!, { target: { files: [file] } });
    expect(props.onLogoLeft).toHaveBeenCalledWith('blob:fake-url', file);
    expect(props.onLogoRight).not.toHaveBeenCalled();
  });

  it('al elegir plantilla invoca onSelectTemplate con el id', () => {
    const props = makeProps();
    render(<GenerateSidebar {...props} />);
    selectOption('Elegir plantilla Canvas', 'Plantilla B');
    expect(props.onSelectTemplate).toHaveBeenCalledWith('t2');
  });

  it('avisa cuando la plantilla no tiene campos Excel', () => {
    render(<GenerateSidebar {...makeProps({ templateValid: true, fieldKeys: [] })} />);
    expect(screen.getByText(/No hay campos Excel/)).toBeInTheDocument();
  });

  it('no muestra el aviso de campos cuando hay fieldKeys', () => {
    render(<GenerateSidebar {...makeProps({ fieldKeys: ['NIS'] })} />);
    expect(screen.queryByText(/No hay campos Excel/)).not.toBeInTheDocument();
  });

  it('toggle de requiere imágenes invoca onRequiresImages', () => {
    const props = makeProps();
    render(<GenerateSidebar {...props} />);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    expect(props.onRequiresImages).toHaveBeenCalledWith(true);
  });

  it('acepta drop de .xlsx y rechaza extensiones no tabulares', () => {
    const props = makeProps();
    const { container } = render(<GenerateSidebar {...props} />);
    const dropZone = container.querySelector('label .border-dashed')!;
    fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('foto.png')] } });
    expect(props.onExcel).not.toHaveBeenCalled();
    const csv = makeFile('datos.csv', 'text/csv');
    fireEvent.drop(dropZone, { dataTransfer: { files: [csv] } });
    expect(props.onExcel).toHaveBeenCalledWith(csv);
    expect(props.setDragData).toHaveBeenCalledWith(false);
  });

  it('el paso de mapeo queda deshabilitado sin headers', () => {
    render(<GenerateSidebar {...makeProps({ headers: [] })} />);
    const stepTitle = screen.getByText('Mapeo de Columnas');
    const step = stepTitle.closest('.rounded-lg.border')!;
    expect(step.className).toContain('pointer-events-none');
  });

  it('con headers y fieldKeys permite elegir columna ID y mapear campos', () => {
    const props = makeProps({ headers: ['NIS', 'NOMBRE'], fieldKeys: ['NIS', 'CENTRO'], idColumn: 'NIS' });
    render(<GenerateSidebar {...props} />);
    selectOption('Columna ID (Clave)', 'NOMBRE');
    expect(props.onIdColumn).toHaveBeenCalledWith('NOMBRE');
    selectOption('Mapeo CENTRO', 'NOMBRE');
    expect(props.onMapping).toHaveBeenCalledWith('CENTRO', 'NOMBRE');
  });

  it('el paso de imágenes muestra "No requerido" cuando requiresImages es false', () => {
    render(<GenerateSidebar {...makeProps({ requiresImages: false })} />);
    expect(screen.getByText('No requerido')).toBeInTheDocument();
  });

  it('drop de imágenes filtra archivos que no son image/*', () => {
    const props = makeProps({ requiresImages: true, idColumn: 'NIS' });
    const { container } = render(<GenerateSidebar {...props} />);
    const img = makeFile('a.jpg', 'image/jpeg');
    const txt = makeFile('b.txt', 'text/plain');
    const zones = container.querySelectorAll('label .border-dashed');
    const imagesZone = zones[zones.length - 1];
    fireEvent.drop(imagesZone, { dataTransfer: { files: [img, txt] } });
    expect(props.onAppendImages).toHaveBeenCalledWith([img]);
  });

  it('búsqueda invoca onSearchOrder y salta a la fila que coincide', () => {
    const rows = [{ NIS: '100' }, { NIS: '200' }, { NIS: '300' }];
    const props = makeProps({ rows, headers: ['NIS'], idColumn: 'NIS', requiresImages: false });
    render(<GenerateSidebar {...props} />);
    const input = screen.getByPlaceholderText('Buscar orden...');
    fireEvent.change(input, { target: { value: '200' } });
    expect(props.onSearchOrder).toHaveBeenCalledWith('200');
    expect(props.onRowIndex).toHaveBeenCalledWith(1);
  });

  it('búsqueda sin coincidencias no cambia la fila', () => {
    const rows = [{ NIS: '100' }];
    const props = makeProps({ rows, headers: ['NIS'], idColumn: 'NIS' });
    render(<GenerateSidebar {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar orden...'), { target: { value: 'zzz' } });
    expect(props.onRowIndex).not.toHaveBeenCalled();
  });

  it('el selector de fila se deshabilita con alcance "all"', () => {
    const rows = [{ NIS: '100' }];
    render(<GenerateSidebar {...makeProps({ rows, headers: ['NIS'], idColumn: 'NIS', exportScope: 'all' })} />);
    expect(screen.getByLabelText('Seleccionar Fila')).toBeDisabled();
  });

  it('exportar está deshabilitado sin filas y cambia a consolidado con scope all', () => {
    const noRows = makeProps();
    render(<GenerateSidebar {...noRows} />);
    expect(screen.getByRole('button', { name: /Descargar PDF/ })).toBeDisabled();
    expect(screen.getByTestId('canvas-export-scope-hint')).toHaveTextContent('Carga un Excel/CSV');
  });

  it('con filas habilita exportar e imprimir según el alcance', () => {
    const rows = [{ NIS: '100' }, { NIS: '200' }];
    const props = makeProps({ rows, headers: ['NIS'], idColumn: 'NIS', exportScope: 'all' });
    render(<GenerateSidebar {...props} />);
    const exportBtn = screen.getByRole('button', { name: /PDF Consolidado/ });
    expect(exportBtn).toBeEnabled();
    fireEvent.click(exportBtn);
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Imprimir/ })).toBeDisabled();
    expect(screen.getByTestId('canvas-export-scope-hint')).toHaveTextContent('2 filas en un PDF consolidado');
  });

  it('exportar single se deshabilita cuando rowIndex apunta fuera de las filas', () => {
    const rows = [{ NIS: '100' }];
    render(<GenerateSidebar {...makeProps({ rows, headers: ['NIS'], idColumn: 'NIS', exportScope: 'single', rowIndex: 5 })} />);
    expect(screen.getByRole('button', { name: /Descargar PDF/ })).toBeDisabled();
  });

  it('busy muestra "Generando…" y deshabilita exportar', () => {
    const rows = [{ NIS: '100' }];
    render(<GenerateSidebar {...makeProps({ rows, headers: ['NIS'], idColumn: 'NIS', busy: true })} />);
    expect(screen.getByRole('button', { name: /Generando/ })).toBeDisabled();
  });

  it('modo CMYK muestra perfil ICC, sangrado y marcas de corte', () => {
    const props = makeProps({ rows: [{ NIS: '1' }], headers: ['NIS'], idColumn: 'NIS', colorMode: 'cmyk' });
    render(<GenerateSidebar {...props} />);
    expect(screen.getByLabelText('Perfil ICC')).toBeInTheDocument();
    expect(screen.getByLabelText('Sangrado Bleed')).toBeInTheDocument();
    expect(screen.getByText('Marcas de corte y registro')).toBeInTheDocument();
    expect(screen.queryByLabelText('Calidad del PDF')).not.toBeInTheDocument();
  });

  it('modo RGB muestra selector de calidad en vez de opciones CMYK', () => {
    render(<GenerateSidebar {...makeProps({ rows: [{ NIS: '1' }], headers: ['NIS'], idColumn: 'NIS', colorMode: 'rgb' })} />);
    expect(screen.getByLabelText('Calidad del PDF')).toBeInTheDocument();
    expect(screen.queryByLabelText('Perfil ICC')).not.toBeInTheDocument();
  });

  it('muestra el mensaje de error cuando existe', () => {
    render(<GenerateSidebar {...makeProps({ error: 'Fallo al generar' })} />);
    expect(screen.getByText('Fallo al generar')).toBeInTheDocument();
  });
});
