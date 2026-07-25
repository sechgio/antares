import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import { buildLayerPaintStyle } from '../ops/layerPaint';
import {
  buildLayerTransform,
  collectDocumentColors,
  cssVarsToStyleParts,
  formatBoxShadow,
  hexToRgba,
  imageContentInlineStyle,
  isAspectLocked,
  layerPanelTitle,
  parseBoxShadow,
  parseBoxShadows,
  parseFilterBlurPx,
  parseImageZoom,
  resizeWithAspectLock,
  resolveFillBackground,
  resolveFillColor,
  resolveFilter,
  resolveBorderRadius,
  resolveStrokeStyle,
  toggleFlip,
} from '../ops/layerStyle';
import { parseMm } from '../types';
import RightPanel from '../editor/RightPanel';
import PaintRow from '../editor/PaintRow';
import LayerNode from '../editor/LayerNode';

const panelProps = {
  selectedCount: 1,
  pageColors: [] as string[],
  onDelete: vi.fn(),
  onAlign: vi.fn(),
  onDistribute: vi.fn(),
  onBulkVisible: vi.fn(),
  onBulkLocked: vi.fn(),
  onBulkOpacity: vi.fn(),
  onBringFront: vi.fn(),
  onBringForward: vi.fn(),
  onSendBack: vi.fn(),
  onSendBackward: vi.fn(),
};

describe('layerStyle', () => {
  it('toggleFlip flips scale-x', () => {
    const layer = createLayer('rect');
    const flipped = toggleFlip(layer, 'x');
    expect(flipped.cssVars['--scale-x']).toBe('-1');
    expect(toggleFlip(flipped, 'x').cssVars['--scale-x']).toBe('1');
  });

  it('resizeWithAspectLock updates height when locked', () => {
    const layer = createLayer('rect');
    layer.cssVars['--width'] = '100mm';
    layer.cssVars['--height'] = '50mm';
    layer.cssVars['--aspect-locked'] = '1';
    expect(isAspectLocked(layer.cssVars)).toBe(true);
    const next = resizeWithAspectLock(layer, 'width', 200);
    expect(parseMm(next.cssVars['--width'])).toBe(200);
    expect(parseMm(next.cssVars['--height'])).toBe(100);
  });

  it('buildLayerTransform includes rotate and scale', () => {
    expect(
      buildLayerTransform({
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--rotate': '15deg',
        '--scale-x': '-1',
      }),
    ).toBe('rotate(15deg) scaleX(-1)');
  });

  it('cssVarsToStyleParts includes fill opacity, shadow and transform', () => {
    const parts = cssVarsToStyleParts({
      '--width': '10mm',
      '--height': '10mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--background-color': '#FF0000',
      '--fill-opacity': '50',
      '--border-width': '2px',
      '--border-color': '#000000',
      '--stroke-align': 'inside',
      '--box-shadow': formatBoxShadow({ color: '#000000', x: 0, y: 4, blur: 8, opacity: 25 }),
      '--rotate': '10deg',
      '--scale-y': '-1',
    });
    const css = parts.join(';');
    expect(css).toContain('background-color:rgba(255,0,0,0.5)');
    expect(css).toContain('box-shadow:');
    expect(css).toContain('transform:rotate(10deg) scaleY(-1)');
    expect(css).toContain('border:2px solid');
  });

  it('resolveFillColor and resolveStrokeStyle honor opacity and visibility', () => {
    expect(
      resolveFillColor({
        '--width': '1mm',
        '--height': '1mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--background-color': '#00FF00',
        '--fill-opacity': '40',
      }),
    ).toBe('rgba(0,255,0,0.4)');
    expect(
      resolveFillColor({
        '--width': '1mm',
        '--height': '1mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--background-color': '#00FF00',
        '--fill-visible': '0',
      }),
    ).toBe('transparent');
    const stroke = resolveStrokeStyle({
      '--width': '1mm',
      '--height': '1mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--border-width': '2px',
      '--border-color': '#0000FF',
      '--stroke-opacity': '50',
      '--stroke-align': 'inside',
    });
    expect(stroke.border).toBe('2px solid rgba(0,0,255,0.5)');
  });

  it('resolveBorderRadius supports independent corners', () => {
    expect(
      resolveBorderRadius({
        '--border-radius': '4px',
        '--radius-tl': '10px',
        '--radius-tr': '0px',
      }),
    ).toBe('10px 0px 4px 4px');
  });

  it('resolveFillBackground builds linear gradients', () => {
    expect(
      resolveFillBackground({
        '--width': '1mm',
        '--height': '1mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--background-color': '#FF0000',
        '--fill-color-2': '#0000FF',
        '--fill-type': 'linear',
        '--fill-angle': '90',
        '--fill-opacity': '100',
      }),
    ).toBe('linear-gradient(90deg, #FF0000, #0000FF)');
  });

  it('resolveFillBackground builds radial gradients', () => {
    expect(
      resolveFillBackground({
        '--width': '1mm',
        '--height': '1mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--background-color': '#FF0000',
        '--fill-color-2': '#0000FF',
        '--fill-type': 'radial',
        '--fill-opacity': '100',
      }),
    ).toBe('radial-gradient(circle at center, #FF0000, #0000FF)');
  });

  it('resolveStrokeStyle supports dashed borders', () => {
    const stroke = resolveStrokeStyle({
      '--width': '1mm',
      '--height': '1mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--border-width': '2px',
      '--border-color': '#000000',
      '--stroke-dash': 'dashed',
      '--stroke-align': 'inside',
    });
    expect(stroke.border).toBe('2px dashed #000000');
  });

  it('cssVarsToStyleParts includes linear fill and layer blur', () => {
    const css = cssVarsToStyleParts({
      '--width': '10mm',
      '--height': '10mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--background-color': '#FF0000',
      '--fill-color-2': '#0000FF',
      '--fill-type': 'linear',
      '--fill-angle': '180',
      '--filter-blur': '4px',
    }).join(';');
    expect(css).toContain('background:linear-gradient(180deg, #FF0000, #0000FF)');
    expect(css).toContain('filter:blur(4px)');
  });

  it('buildLayerPaintStyle matches cssVarsToStyleParts and scales font-size', () => {
    const paint = buildLayerPaintStyle(
      {
        '--background-color': '#FF0000',
        '--fill-opacity': '50',
        '--font-size': '10px',
        '--color': '#111111',
      },
      { scale: 2 },
    );
    expect(paint.backgroundColor).toMatch(/rgba?\(255,\s*0,\s*0/i);
    expect(paint.fontSize).toBe('20px');
    expect(paint.color).toBe('#111111');
  });

  it('parseFilterBlurPx, resolveFilter and imageContentInlineStyle', () => {
    expect(parseFilterBlurPx({ '--filter-blur': '8px' })).toBe(8);
    expect(resolveFilter({ '--filter-blur': '0px' })).toBeUndefined();
    expect(parseImageZoom({ '--image-zoom': '1.5' })).toBe(1.5);
    const img = imageContentInlineStyle({
      '--object-fit': 'contain',
      '--object-position': '0% 50%',
      '--image-zoom': '2',
    });
    expect(img).toContain('object-fit:contain');
    expect(img).toContain('object-position:0% 50%');
    expect(img).toContain('transform:scale(2)');
  });

  it('hexToRgba and parseBoxShadow round-trip', () => {
    expect(hexToRgba('#ABC', 100)).toBe('#AABBCC');
    const shadow = parseBoxShadow('0px 4px 8px rgba(0,0,0,0.25)');
    expect(shadow).toMatchObject({ x: 0, y: 4, blur: 8, opacity: 25 });
  });

  it('collectDocumentColors dedupes', () => {
    const a = createLayer('rect');
    a.cssVars['--background-color'] = '#D9D9D9';
    const b = createLayer('rect');
    b.cssVars['--background-color'] = '#D9D9D9';
    b.cssVars['--border-color'] = '#000000';
    expect(collectDocumentColors([a, b])).toEqual(['#D9D9D9', '#000000']);
  });

  it('layerPanelTitle maps rect defaults', () => {
    const layer = createLayer('rect');
    expect(layerPanelTitle(layer)).toBe('Rectángulo');
  });
});

describe('PaintRow applies paint in one update', () => {
  it('hex edit and opacity edit both land via onPaintChange', () => {
    const onPaintChange = vi.fn();
    render(
      <PaintRow
        color="#FFFFFF"
        opacity={100}
        visible
        pageColors={[]}
        onPaintChange={onPaintChange}
        onVisibleChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: 'FF5500' } });
    expect(onPaintChange).toHaveBeenCalledWith('#FF5500', 100);
    fireEvent.change(screen.getByLabelText('Opacidad relleno'), { target: { value: '60' } });
    expect(onPaintChange).toHaveBeenCalledWith('#FFFFFF', 60);
  });

  it('opens color picker beside the swatch', () => {
    render(
      <PaintRow
        color="#112233"
        opacity={80}
        visible
        pageColors={['#AABBCC']}
        onPaintChange={vi.fn()}
        onVisibleChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Color'));
    const picker = screen.getByTestId('canvas-color-picker');
    expect(picker).toBeTruthy();
    expect((picker as HTMLElement).style.left).toBeTruthy();
    expect((picker as HTMLElement).style.top).toBeTruthy();
  });
});

describe('LayerNode applies fill from cssVars', () => {
  it('sets backgroundColor from resolveFillColor', () => {
    const layer = createLayer('rect');
    layer.cssVars['--background-color'] = '#FF0000';
    layer.cssVars['--fill-opacity'] = '50';
    const { container } = render(
      <LayerNode
        layer={layer}
        selected={false}
        interactive
        scale={1}
        onSelect={vi.fn()}
        onLayerPointerDown={vi.fn()}
      />,
    );
    const node = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(node.style.backgroundColor).toMatch(/rgba?\(255,\s*0,\s*0/i);
  });
});

describe('RightPanel shape inspector', () => {
  it('shows Figma-like sections for a selected rectangle', () => {
    const layer = createLayer('rect');
    const onChange = vi.fn();
    render(<RightPanel layer={layer} onChange={onChange} {...panelProps} pageColors={['#D9D9D9']} />);

    expect(screen.getByText('Rectángulo')).toBeTruthy();
    expect(screen.getAllByText('Posición').length).toBeGreaterThan(0);
    expect(screen.getByText('Disposición')).toBeTruthy();
    expect(screen.getByText('Apariencia')).toBeTruthy();
    expect(screen.getByText('Relleno')).toBeTruthy();
    expect(screen.getByText('Trazo')).toBeTruthy();
    expect(screen.getByText('Efectos')).toBeTruthy();
    expect(screen.getByText('Exportar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeTruthy();
  });

  it('multi-select shows bulk panel only', () => {
    const layer = createLayer('rect');
    render(<RightPanel layer={layer} onChange={vi.fn()} {...panelProps} selectedCount={3} />);
    expect(screen.getByText('3 seleccionados')).toBeTruthy();
    expect(screen.queryByText('Relleno')).toBeNull();
    expect(screen.getByLabelText('Adelante')).toBeTruthy();
  });

  it('fill hex change updates background-color and keeps opacity in one onChange', () => {
    const layer = createLayer('rect');
    layer.cssVars['--fill-opacity'] = '75';
    const onChange = vi.fn();
    const onChangeLive = vi.fn();
    const onCommitLive = vi.fn();
    render(
      <RightPanel
        layer={layer}
        onChange={onChange}
        onChangeLive={onChangeLive}
        onCommitLive={onCommitLive}
        {...panelProps}
      />,
    );
    const hexInputs = screen.getAllByLabelText('Hex');
    fireEvent.change(hexInputs[0], { target: { value: 'AABBCC' } });
    expect(onChangeLive).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const next = onChangeLive.mock.calls[0][0];
    expect(next.cssVars['--background-color']).toBe('#AABBCC');
    expect(next.cssVars['--fill-opacity']).toBe('75');
    fireEvent.blur(hexInputs[0]);
    expect(onCommitLive).toHaveBeenCalled();
  });

  it('aspect lock button toggles css var', () => {
    const layer = createLayer('rect');
    const onChange = vi.fn();
    render(<RightPanel layer={layer} onChange={onChange} {...panelProps} />);
    fireEvent.click(screen.getByLabelText('Proporciones'));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.cssVars['--aspect-locked']).toBe('1');
  });

  it('flip horizontal toggles scale-x', () => {
    const layer = createLayer('rect');
    const onChange = vi.fn();
    render(<RightPanel layer={layer} onChange={onChange} {...panelProps} />);
    fireEvent.click(screen.getByLabelText('Voltear horizontal'));
    expect(onChange.mock.calls[0][0].cssVars['--scale-x']).toBe('-1');
  });

  it('shows empty properties panel when nothing is selected', () => {
    render(<RightPanel layer={null} selectedCount={0} onChange={vi.fn()} {...panelProps} />);
    expect(screen.queryByText(/Selecciona una capa/i)).toBeNull();
    expect(screen.getByText('Propiedades')).toBeTruthy();
    expect(screen.getByTestId('canvas-zoom-slot')).toBeTruthy();
  });

  it('shows Plantillas under Propiedades when nothing is selected', () => {
    const onApplyPreset = vi.fn();
    render(
      <RightPanel
        {...panelProps}
        layer={null}
        selectedCount={0}
        onChange={vi.fn()}
        onApplyPreset={onApplyPreset}
      />,
    );
    expect(screen.getByText('Plantillas')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Aplicar plantilla Panel fotográfico'));
    expect(onApplyPreset).toHaveBeenCalledWith('report');
  });

  it('hides Plantillas in right panel when a layer is selected', () => {
    render(
      <RightPanel
        {...panelProps}
        layer={createLayer('rect')}
        selectedCount={1}
        onChange={vi.fn()}
        onApplyPreset={vi.fn()}
      />,
    );
    expect(screen.queryByText('Plantillas')).toBeNull();
  });

  it('shows logo side conflict hint when logoSideConflict is true', () => {
    const layer = createLayer('logo', { meta: { side: 'left' } });
    render(
      <RightPanel layer={layer} onChange={vi.fn()} {...panelProps} logoSideConflict />,
    );
    expect(screen.getByLabelText('Lado del logo')).toHaveValue('left');
    expect(screen.getByText(/Otra capa usa este lado/i)).toBeTruthy();
  });

  it('accepts free stroke weight via number input and slider (0.1px steps)', () => {
    const layer = createLayer('line');
    const onChangeLive = vi.fn();
    const onCommitLive = vi.fn();
    render(
      <RightPanel
        layer={layer}
        onChange={vi.fn()}
        onChangeLive={onChangeLive}
        onCommitLive={onCommitLive}
        {...panelProps}
      />,
    );

    const numberInput = screen.getByLabelText('Peso del trazo (px)') as HTMLInputElement;
    expect(numberInput.step).toBe('0.1');
    expect(numberInput.min).toBe('0');
    expect(numberInput.max).toBe('100');
    expect(numberInput.title).toBe('Grosor en px (0–100)');
    fireEvent.change(numberInput, { target: { value: '0.1' } });
    expect(onChangeLive).toHaveBeenCalled();
    expect(onChangeLive.mock.calls.at(-1)?.[0].cssVars['--border-width']).toBe('0.1px');

    const slider = screen.getByLabelText('Peso del trazo') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.step).toBe('0.1');
    fireEvent.change(slider, { target: { value: '12.5' } });
    expect(onChangeLive.mock.calls.at(-1)?.[0].cssVars['--border-width']).toBe('12.5px');
    fireEvent.pointerUp(slider);
    expect(onCommitLive).toHaveBeenCalled();
  });

  it('coalesces numeric edits via onChangeLive + onCommitLive on blur', () => {
    const layer = createLayer('rect');
    layer.cssVars['--translate-x'] = '10mm';
    const onChange = vi.fn();
    const onChangeLive = vi.fn();
    const onCommitLive = vi.fn();
    render(
      <RightPanel
        layer={layer}
        onChange={onChange}
        onChangeLive={onChangeLive}
        onCommitLive={onCommitLive}
        {...panelProps}
      />,
    );
    const xInput = screen.getByLabelText('X');
    fireEvent.change(xInput, { target: { value: '25' } });
    expect(onChangeLive).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(parseMm(onChangeLive.mock.calls[0][0].cssVars['--translate-x'])).toBe(25);
    fireEvent.blur(xInput);
    expect(onCommitLive).toHaveBeenCalled();
  });
});

describe('RightPanel creative freedom controls', () => {
  it('blend mode select applies and clears mix-blend mode', () => {
    const layer = createLayer('rect');
    const onChange = vi.fn();
    const { unmount } = render(<RightPanel layer={layer} onChange={onChange} {...panelProps} />);
    fireEvent.change(screen.getByLabelText('Modo de fusión'), { target: { value: 'multiply' } });
    expect(onChange.mock.calls.at(-1)?.[0].cssVars['--blend-mode']).toBe('multiply');
    unmount();

    const blended = { ...layer, cssVars: { ...layer.cssVars, '--blend-mode': 'multiply' } };
    const onChange2 = vi.fn();
    render(<RightPanel layer={blended} onChange={onChange2} {...panelProps} />);
    fireEvent.change(screen.getByLabelText('Modo de fusión'), { target: { value: 'normal' } });
    expect(onChange2.mock.calls.at(-1)?.[0].cssVars['--blend-mode']).toBeUndefined();
  });

  it('resize anchor pins the opposite edge when editing W', () => {
    const layer = createLayer('rect');
    layer.cssVars['--translate-x'] = '10mm';
    layer.cssVars['--width'] = '100mm';
    layer.cssVars['--height'] = '50mm';
    const onChange = vi.fn();
    const { unmount } = render(<RightPanel layer={layer} onChange={onChange} {...panelProps} />);
    fireEvent.click(screen.getByLabelText('Anclar br'));
    expect(onChange.mock.calls.at(-1)?.[0].cssVars['--resize-anchor']).toBe('br');
    unmount();

    const anchored = { ...layer, cssVars: { ...layer.cssVars, '--resize-anchor': 'br' } };
    const onChangeLive = vi.fn();
    render(
      <RightPanel layer={anchored} onChange={vi.fn()} onChangeLive={onChangeLive} {...panelProps} />,
    );
    fireEvent.change(screen.getByLabelText('W'), { target: { value: '200' } });
    const next = onChangeLive.mock.calls.at(-1)?.[0];
    expect(parseMm(next.cssVars['--width'])).toBe(200);
    expect(parseMm(next.cssVars['--translate-x'])).toBe(-90);
  });

  it('lists multiple shadow editors and adds/removes shadows', () => {
    const layer = createLayer('rect');
    layer.cssVars['--box-shadow'] = '0px 4px 8px rgba(0,0,0,0.25), 2px 2px 4px rgba(255,0,0,0.5)';
    const onChange = vi.fn();
    render(<RightPanel layer={layer} onChange={onChange} {...panelProps} />);
    expect(screen.getAllByTestId('canvas-effect-shadow')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Añadir sombra'));
    const added = onChange.mock.calls.at(-1)?.[0].cssVars['--box-shadow'] as string;
    expect(parseBoxShadows(added)).toHaveLength(3);

    fireEvent.click(screen.getAllByLabelText('Quitar sombra')[0]);
    const remaining = parseBoxShadows(onChange.mock.calls.at(-1)?.[0].cssVars['--box-shadow']);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].color).toBe('#FF0000');
  });
});
