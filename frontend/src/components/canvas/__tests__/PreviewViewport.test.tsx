import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PreviewViewport from '../editor/PreviewViewport';

describe('PreviewViewport', () => {
  it('shows floating zoom chip and steps zoom', () => {
    const { container } = render(
      <PreviewViewport html="<html><body>ok</body></html>" widthPx={200} heightPx={280} />,
    );
    expect(screen.getByTestId('generate-preview-viewport')).toBeTruthy();
    expect(screen.getByText('85%')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Acercar'));
    expect(screen.getByText('95%')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Alejar'));
    expect(screen.getByText('85%')).toBeTruthy();

    const stage = container.querySelector('[data-testid="generate-preview-stage"]') as HTMLElement;
    // Crisp zoom: Chromium `zoom` re-rasterizes; never GPU `scale()` a 1× bitmap.
    expect(stage.style.transform).not.toContain('scale(');
    expect(stage.style.willChange || '').toBe('');
    expect(String((stage.style as CSSStyleDeclaration & { zoom?: string }).zoom)).toBe('0.85');
  });

  it('keeps translate pan in screen space when zoomed (pan / zoom compensates CSS zoom)', () => {
    const { container } = render(
      <PreviewViewport html="<html><body>ok</body></html>" widthPx={200} heightPx={280} />,
    );
    fireEvent.click(screen.getByLabelText('Acercar')); // 0.95
    const viewport = screen.getByTestId('generate-preview-viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 70 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    const stage = container.querySelector('[data-testid="generate-preview-stage"]') as HTMLElement;
    const zoom = Number((stage.style as CSSStyleDeclaration & { zoom?: string }).zoom);
    expect(zoom).toBeCloseTo(0.95, 5);
    // translate uses pan/zoom so visual offset stays in screen px after CSS zoom
    expect(stage.style.transform).toMatch(/translate\(/);
    expect(stage.style.transform).not.toMatch(/scale\(/);
  });

  it('does not reassign iframe srcdoc when zooming or panning', () => {
    const html = '<html><body>stable</body></html>';
    const { container } = render(<PreviewViewport html={html} widthPx={200} heightPx={280} />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();

    const assigns: string[] = [];
    const proto = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    const setSpy = vi.fn(function (this: HTMLIFrameElement, value: string) {
      assigns.push(value);
      if (proto?.set) proto.set.call(this, value);
      else this.setAttribute('srcdoc', value);
    });
    Object.defineProperty(iframe, 'srcdoc', {
      configurable: true,
      get() {
        return assigns[assigns.length - 1] ?? html;
      },
      set: setSpy,
    });

    fireEvent.click(screen.getByLabelText('Acercar'));
    const viewport = screen.getByTestId('generate-preview-viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 50 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    expect(setSpy).not.toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBe(iframe);
  });

  it('iframe ignores pointer events so viewport can pan/zoom over the page', () => {
    const { container } = render(
      <PreviewViewport html="<html><body>ok</body></html>" widthPx={200} heightPx={280} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.style.pointerEvents).toBe('none');
  });

  it('LayerNode preview stays at design scale=1; camera uses CSS zoom', () => {
    const { container } = render(
      <PreviewViewport widthPx={200} heightPx={280} ready>
        {(scale) => <div data-testid="preview-scale">{scale}</div>}
      </PreviewViewport>,
    );
    expect(screen.getByTestId('preview-scale').textContent).toBe('1');
    const stage = container.querySelector('[data-testid="generate-preview-stage"]') as HTMLElement;
    expect(String((stage.style as CSSStyleDeclaration & { zoom?: string }).zoom)).toBe('0.85');
    expect(stage.style.width).toBe('200px');
    expect(stage.style.height).toBe('280px');
  });
});
