import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, type CanvasDocument } from '../types';
import type { CanvasPreset } from '../presets/loadPresets';
import { CANVAS_PRESETS } from '../presets';
import { DEFAULT_PRESET_META, presetMeta } from '../presets/presetCategories';
import TemplatePickerModal from '../editor/TemplatePickerModal';

const PRESETS: CanvasPreset[] = [
  { id: 'panel-reservorios', label: 'Panel reservorios', create: (n) => makeDoc(n) },
  { id: 'reservorios-villa-sunass', label: 'Reservorios Villa SUNASS', create: (n) => makeDoc(n) },
  { id: 'cert-sjl-blanco', label: 'Certificado SJL Blanco', create: (n) => makeDoc(n) },
  { id: 'report', label: 'Panel fotográfico', create: (n) => makeDoc(n) },
];

function makeDoc(name?: string): CanvasDocument {
  return createEmptyDocument(name ?? 'Test');
}

vi.mock('../presets/loadPresets', () => ({
  loadCanvasPresets: vi.fn(async () => PRESETS),
}));

vi.mock('../editor/PageLayerPreview', () => ({
  default: () => <div data-testid="page-layer-preview" />,
  documentWithFill: (doc: CanvasDocument) => doc,
}));

function renderPicker(overrides?: Partial<Parameters<typeof TemplatePickerModal>[0]>) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onApplyPreset: vi.fn(),
    onNewFromPreset: vi.fn(),
    onNewBlank: vi.fn(),
    ...overrides,
  };
  const view = render(<TemplatePickerModal {...props} />);
  return { props, ...view };
}

async function openPicker(overrides?: Parameters<typeof renderPicker>[0]) {
  const ctx = renderPicker(overrides);
  await waitFor(() => expect(screen.getByText('Panel reservorios')).toBeTruthy());
  return ctx;
}

describe('TemplatePickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderPicker({ isOpen: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders header, rail nav, cards and the blank card when open', async () => {
    await openPicker();
    expect(screen.getByText('Plantillas')).toBeTruthy();
    expect(screen.getByText('Categorías')).toBeTruthy();
    expect(screen.getByText('Zona')).toBeTruthy();
    expect(screen.getByText('Documento en blanco')).toBeTruthy();
    expect(screen.getByText('Panel fotográfico')).toBeTruthy();
    expect(screen.getByLabelText('Buscar plantillas')).toBeTruthy();
  });

  it('filters cards by category from the rail', async () => {
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: /Certificados/ }));
    expect(screen.getByText('Certificado SJL Blanco')).toBeTruthy();
    expect(screen.queryByText('Panel reservorios')).toBeNull();
    expect(screen.queryByText('Documento en blanco')).toBeNull();
  });

  it('filters cards by district and toggles off on second click', async () => {
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: /^SJL/ }));
    expect(screen.getByText('Certificado SJL Blanco')).toBeTruthy();
    expect(screen.queryByText('Reservorios Villa SUNASS')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^SJL/ }));
    expect(screen.getByText('Reservorios Villa SUNASS')).toBeTruthy();
  });

  it('filters by search query across labels and descriptions', async () => {
    await openPicker();
    fireEvent.change(screen.getByLabelText('Buscar plantillas'), {
      target: { value: 'villa' },
    });
    expect(screen.getByText('Reservorios Villa SUNASS')).toBeTruthy();
    expect(screen.queryByText('Panel reservorios')).toBeNull();
  });

  it('Escape clears a focused search query first, then closes the modal', async () => {
    const { props } = await openPicker();
    const input = screen.getByLabelText('Buscar plantillas');
    fireEvent.change(input, { target: { value: 'villa' } });
    input.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the lightbox before the modal', async () => {
    const { props } = await openPicker();
    fireEvent.click(screen.getByLabelText('Vista previa de Panel reservorios'));
    expect(screen.getAllByRole('dialog').length).toBe(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog').length).toBe(1);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('wires create, apply and blank actions', async () => {
    const { props } = await openPicker();
    fireEvent.click(screen.getByLabelText('Aplicar Panel reservorios al lienzo actual'));
    expect(props.onApplyPreset).toHaveBeenCalledWith(PRESETS[0]);
    expect(props.onClose).toHaveBeenCalled();
    vi.clearAllMocks();
    const card = screen.getByLabelText('Vista previa de Panel reservorios').closest('article');
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /Crear/ }));
    expect(props.onNewFromPreset).toHaveBeenCalledWith(PRESETS[0]);
    expect(props.onClose).toHaveBeenCalled();
    vi.clearAllMocks();
    fireEvent.click(screen.getByLabelText('Crear documento en blanco'));
    expect(props.onNewBlank).toHaveBeenCalled();
  });

  it('every bundled preset has explicit metadata (no silent fallback)', () => {
    for (const preset of CANVAS_PRESETS) {
      expect(presetMeta(preset.id), `missing meta for ${preset.id}`).not.toBe(DEFAULT_PRESET_META);
    }
  });
});
