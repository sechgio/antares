import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./PdfPagePreview', () => ({
  default: ({ overlay }: { overlay: React.ReactNode }) => (
    <div data-testid="pdf-preview">{overlay}</div>
  ),
}));

import StampPlacementEditor from './StampPlacementEditor';
import type { StampPosition } from './types';

const pageSize = { width: 612, height: 792 };

function makePositions(): StampPosition[] {
  return [
    { id: 'p1', name: 'Sello A', rect: { x: 100, y: 200, width: 120, height: 60 } },
    { id: 'p2', name: 'Sello B', rect: { x: 300, y: 400, width: 80, height: 40 } },
  ];
}

describe('StampPlacementEditor', () => {
  it('renderiza overlay activo e inactivo con nombres', () => {
    render(
      <StampPlacementEditor
        stampUrl="data:image/png;base64,x"
        positions={makePositions()}
        activeIndex={0}
        pageSize={pageSize}
        previewWidth={400}
        onChangePosition={vi.fn()}
      />,
    );
    expect(screen.getByText('Sello A')).toBeInTheDocument();
    expect(screen.getByText('Sello B')).toBeInTheDocument();
    expect(screen.getByLabelText('Redimensionar sello')).toBeInTheDocument();
  });

  it('no renderiza nada si no hay posiciones', () => {
    const { container } = render(
      <StampPlacementEditor
        stampUrl="x"
        positions={[]}
        activeIndex={0}
        pageSize={pageSize}
        previewWidth={400}
        onChangePosition={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('mousedown en el overlay activa modo move y mouseup llama onChangePosition', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StampPlacementEditor
        stampUrl="x"
        positions={makePositions()}
        activeIndex={0}
        pageSize={pageSize}
        previewWidth={400}
        onChangePosition={onChange}
      />,
    );
    const overlay = container.querySelector('.cursor-grab')!;
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    // sin imagen con data-stamp-page-image, toPdfPoint da (0,0); move aplica delta
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenCalledWith(0, expect.objectContaining({ width: 120 }));
  });

  it('mousedown en el handle de resize activa modo resize', () => {
    const onChange = vi.fn();
    render(
      <StampPlacementEditor
        stampUrl="x"
        positions={makePositions()}
        activeIndex={0}
        pageSize={pageSize}
        previewWidth={400}
        onChangePosition={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('Redimensionar sello'), { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('drop recentra el sello y notifica', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StampPlacementEditor
        stampUrl="x"
        positions={makePositions()}
        activeIndex={0}
        pageSize={pageSize}
        previewWidth={400}
        onChangePosition={onChange}
      />,
    );
    fireEvent.drop(container.firstElementChild!, { clientX: 50, clientY: 50 });
    expect(onChange).toHaveBeenCalledWith(0, expect.objectContaining({ width: 120, height: 60 }));
  });
});
