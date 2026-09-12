import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import FloatingPanelFrame from './FloatingPanelFrame';

describe('FloatingPanelFrame', () => {
  it('preserves panel controls, classes and drag hint', () => {
    const onPinToggle = vi.fn();
    const onResetPosition = vi.fn();
    const onClose = vi.fn();

    render(
      <FloatingPanelFrame
        panelRef={createRef<HTMLDivElement>()}
        position={{ x: 12, y: 34 }}
        isDragging={false}
        isPinned={false}
        onMouseDown={vi.fn()}
        onPinToggle={onPinToggle}
        onResetPosition={onResetPosition}
        onClose={onClose}
        className="vgen-records-panel"
        title={<span>Lotes (2)</span>}
      >
        <div>Contenido</div>
      </FloatingPanelFrame>,
    );

    const panel = screen.getByText('Contenido').closest('.vgen-floating-panel');
    expect(panel).toHaveClass('vgen-records-panel');
    expect(panel).toHaveStyle({ left: '12px', top: '34px', cursor: 'default' });
    expect(screen.getByText('Arrastra para mover')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fijar posición' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer posición' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
    expect(onPinToggle).toHaveBeenCalledTimes(1);
    expect(onResetPosition).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
