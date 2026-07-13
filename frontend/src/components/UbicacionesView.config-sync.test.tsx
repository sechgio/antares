import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewPayloads: Record<string, unknown>[] = [];
const generatePayloads: Record<string, unknown>[] = [];

const { mockPreview, mockGenerate, mockKeysGet, mockKeysSet } = vi.hoisted(() => ({
  mockPreview: vi.fn(async (body: Record<string, unknown>) => {
    previewPayloads.push(body);
    return {
      success: true,
      data: {
        image: 'data:image/png;base64,abc',
        cod_componente: 'COD-1',
        direccion: 'Calle 1',
        localidad: 'Loc',
        distrito: 'Dist',
        total_filas: 2,
        row_index: body.rowIndex ?? 0,
        formato: body.formato,
      },
    };
  }),
  mockGenerate: vi.fn(async (body: Record<string, unknown>) => {
    generatePayloads.push(body);
    return { success: true, data: { generados: 1, fallidos: 0, consolidado: body.consolidado } };
  }),
  mockKeysGet: vi.fn(async () => ({ keys: {} })),
  mockKeysSet: vi.fn(async (keys: Record<string, string>) => ({ keys })),
}));

vi.mock('../api', () => ({
  api: {
    previewUbicacion: mockPreview,
    generarUbicaciones: mockGenerate,
    ubicacionesKeysGet: mockKeysGet,
    ubicacionesKeysSet: mockKeysSet,
  },
}));

import { UbicacionesView, loadCustomStylesFromStorage } from './UbicacionesView';

const EXCEL_PATH = 'C:\\data\\ubicaciones.xlsx';
const OUTPUT_DIR = 'C:\\salida\\ubicaciones';

function setupElectronApi() {
  const electronApi = window.electronAPI!;
  vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
    if (method === 'dialog_folder') {
      return { folder: OUTPUT_DIR };
    }
    return {};
  });
  Object.defineProperty(electronApi, 'getPathForFile', {
    value: (file: File) => (file.name.endsWith('.xlsx') ? EXCEL_PATH : ''),
    configurable: true,
  });
}

async function uploadExcel() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['excel'], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(mockPreview).toHaveBeenCalled());
}

async function selectOutputFolder() {
  fireEvent.click(screen.getByRole('button', { name: /Seleccionar carpeta/i }));
  await waitFor(() => {
    expect(localStorage.getItem('antares:ubicaciones:outputDir')).toBe(OUTPUT_DIR);
  });
}

function renderView() {
  return render(<UbicacionesView />);
}

describe('UbicacionesView config sync', () => {
  beforeEach(() => {
    previewPayloads.length = 0;
    generatePayloads.length = 0;
    mockPreview.mockClear();
    mockGenerate.mockClear();
    setupElectronApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists design settings across remount', async () => {
    const { unmount } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Personalización de Diseño/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mapa$/i }));

    const zoomSlider = document.querySelector('input[type="range"][min="12"][max="20"]') as HTMLInputElement;
    expect(zoomSlider).toBeTruthy();
    fireEvent.change(zoomSlider, { target: { value: '15' } });

    await waitFor(() => {
      expect(localStorage.getItem('antares:ubicaciones:zoom')).toBe('15');
    });

    unmount();
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Personalización de Diseño/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mapa$/i }));
    const restored = document.querySelector('input[type="range"][min="12"][max="20"]') as HTMLInputElement;
    expect(restored.value).toBe('15');
  });

  it('persists session config across remount', async () => {
    const { unmount } = renderView();

    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    fireEvent.click(screen.getByRole('button', { name: /Horizontal/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Consolidado/i })[0]);
    await selectOutputFolder();

    await waitFor(() => {
      expect(localStorage.getItem('antares:ubicaciones:inputMode')).toBe('manual');
      expect(localStorage.getItem('antares:ubicaciones:formato')).toBe('horizontal');
      expect(localStorage.getItem('antares:ubicaciones:outputMode')).toBe('consolidado');
    });

    unmount();
    renderView();

    expect(localStorage.getItem('antares:ubicaciones:inputMode')).toBe('manual');
    expect(localStorage.getItem('antares:ubicaciones:formato')).toBe('horizontal');
    expect(localStorage.getItem('antares:ubicaciones:outputMode')).toBe('consolidado');
    expect(screen.getByText(OUTPUT_DIR)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generar PDF Consolidado/i })).toBeInTheDocument();
  });

  it('sends updated formato to preview when orientation changes', async () => {
    renderView();
    await uploadExcel();

    mockPreview.mockClear();
    previewPayloads.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /Horizontal/i }));

    await waitFor(() => {
      expect(previewPayloads.some((p) => p.formato === 'horizontal')).toBe(true);
    });
  });

  it('sends full config to generarUbicaciones', async () => {
    renderView();
    await uploadExcel();
    await selectOutputFolder();

    fireEvent.click(screen.getByRole('button', { name: /Horizontal/i }));
    fireEvent.click(screen.getByRole('button', { name: /Consolidado/i }));

    mockGenerate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF Consolidado/i }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    const payload = generatePayloads.at(-1)!;
    expect(payload.excelPath).toBe(EXCEL_PATH);
    expect(payload.outputDir).toBe(OUTPUT_DIR);
    expect(payload.formato).toBe('horizontal');
    expect(payload.consolidado).toBe(true);
    expect(payload.provider).toBe('osm');
    expect(payload.zoom).toBe(18);
    expect(payload.customStyles).toBeTruthy();
  });

  it('re-fetches excel preview when switching back from manual mode', async () => {
    renderView();
    await uploadExcel();

    mockPreview.mockClear();
    previewPayloads.length = 0;

    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    fireEvent.change(screen.getByPlaceholderText('-12.3456'), { target: { value: '-12.05' } });
    fireEvent.change(screen.getByPlaceholderText('-77.1234'), { target: { value: '-77.04' } });

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());

    mockPreview.mockClear();
    previewPayloads.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /^Excel$/i }));

    await waitFor(() => {
      const last = previewPayloads.at(-1);
      expect(last?.excelPath).toBe(EXCEL_PATH);
      expect(last?.manualData).toBeUndefined();
    });
  });

  it('preview and generate share map/style config from the same state', async () => {
    renderView();
    await uploadExcel();
    await selectOutputFolder();

    fireEvent.click(screen.getByRole('button', { name: /Horizontal/i }));
    await waitFor(() => previewPayloads.some((p) => p.formato === 'horizontal'));

    mockGenerate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Generar PDF/i }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());

    const preview = previewPayloads.find((p) => p.formato === 'horizontal')!;
    const generate = generatePayloads.at(-1)!;

    expect(generate.formato).toBe(preview.formato);
    expect(generate.provider).toBe(preview.provider);
    expect(generate.zoom).toBe(preview.zoom);
    expect(generate.customStyles).toEqual(preview.customStyles);
  });

  it('sends recomposeOnly preview when overlay opacity changes', async () => {
    renderView();
    await uploadExcel();

    fireEvent.click(screen.getByRole('button', { name: /Personalización de Diseño/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mapa$/i }));

    mockPreview.mockClear();
    previewPayloads.length = 0;

    const opacityLabel = screen.getByText('Opacidad');
    const opacitySlider = opacityLabel.parentElement?.querySelector('input[type="range"]');
    expect(opacitySlider).toBeTruthy();
    fireEvent.change(opacitySlider!, { target: { value: '200' } });

    await waitFor(() => {
      const last = previewPayloads.at(-1);
      expect(last?.recomposeOnly).toBe(true);
      expect((last?.customStyles as { map?: { overlayAlpha?: number } })?.map?.overlayAlpha).toBe(200);
    });
  });

  it('re-fetches map preview when zoom changes', async () => {
    renderView();
    await uploadExcel();

    fireEvent.click(screen.getByRole('button', { name: /Personalización de Diseño/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mapa$/i }));

    mockPreview.mockClear();
    previewPayloads.length = 0;

    const zoomLabel = screen.getByText('Zoom');
    const zoomSlider = zoomLabel.parentElement?.querySelector('input[type="range"]');
    expect(zoomSlider).toBeTruthy();
    fireEvent.change(zoomSlider!, { target: { value: '16' } });

    await waitFor(() => {
      const last = previewPayloads.at(-1);
      expect(last?.recomposeOnly).toBe(false);
      expect(last?.zoom).toBe(16);
    });
  });

  it('sends updated manualData on text field change', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    fireEvent.change(screen.getByPlaceholderText('-12.3456'), { target: { value: '-12.0464' } });
    fireEvent.change(screen.getByPlaceholderText('-77.1234'), { target: { value: '-77.0428' } });
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());

    mockPreview.mockClear();
    previewPayloads.length = 0;

    fireEvent.change(screen.getByPlaceholderText('Ej. Av. Principal 123'), {
      target: { value: 'Av. Nueva 456' },
    });

    await waitFor(() => {
      const last = previewPayloads.at(-1);
      expect(last?.recomposeOnly).toBe(true);
      expect((last?.manualData as { direccion?: string })?.direccion).toBe('Av. Nueva 456');
    });
  });

  it('does not preview manual coords until both are valid', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    mockPreview.mockClear();

    fireEvent.change(screen.getByPlaceholderText('-12.3456'), { target: { value: '-12.04' } });
    await new Promise((r) => setTimeout(r, 500));

    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('loads manual preview on mount when coords are already saved', async () => {
    localStorage.setItem('antares:ubicaciones:inputMode', 'manual');
    localStorage.setItem(
      'antares:ubicaciones:manualData',
      JSON.stringify({
        cod_componente: 'UBI-1',
        direccion: 'Av. Test 1',
        localidad: 'Loc',
        distrito: 'Dist',
        lat: '-12.0464',
        lon: '-77.0428',
      }),
    );

    renderView();

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    const last = previewPayloads.at(-1)!;
    expect(last.manualData).toMatchObject({ lat: '-12.0464', lon: '-77.0428' });
    expect(last.excelPath).toBeNull();
  });

  it('shows loading then preview after entering both manual coords', async () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    mockPreview.mockClear();
    previewPayloads.length = 0;

    fireEvent.change(screen.getByPlaceholderText('-12.3456'), { target: { value: '-12.0464' } });
    fireEvent.change(screen.getByPlaceholderText('-77.1234'), { target: { value: '-77.0428' } });

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByAltText(/Ubicacion/i)).toBeInTheDocument();
    });
  });

  it('deep-merges partial customStyles from localStorage', () => {
    localStorage.setItem(
      'antares:ubicaciones:customStyles',
      JSON.stringify({ texts: { cod_componente: { fontSize: 99 } } }),
    );

    const styles = loadCustomStylesFromStorage();
    expect(styles.texts.cod_componente.fontSize).toBe(99);
    expect(styles.texts.direccion.fontSize).toBe(60);
    expect(styles.pin.scale).toBe(0.15);
    expect(styles.layout.yStart).toBe(120);
  });
});
